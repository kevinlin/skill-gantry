import type { DatabaseSync } from 'node:sqlite'
import { getAdapter } from '../adapters/registry.js'
import type { ToolOutcome } from '../types.js'
import {
  type DetectorSuppressionRow,
  detectorSaysGone,
  type IssueState,
  issueSuppression,
  stateOnAbsence,
} from './issues.js'

export interface ReconcileToolRun {
  toolRunId: number
  toolId: string
  outcome: ToolOutcome
  /** Fingerprints this tool run reported — suppressed ones included (R8.15). */
  reported: ReadonlySet<string>
  /**
   * Of those, the ones whose every occurrence was suppressed, mapped to the
   * tool's own justification. A subset of `reported`, never a replacement for
   * part of it: a suppressed finding is reported, and that is what holds its
   * issue open instead of closing it as fixed.
   */
  suppressed: ReadonlyMap<string, string>
}

/**
 * R8.15's issue-level cache, recomputed from the detector rows.
 *
 * Exported because §10.6's rule-map migration must call it after a merge: a
 * second copy of the conjunction is how the two would come to disagree.
 */
export function recomputeIssueSuppression(db: DatabaseSync, fingerprint: string): void {
  const rows = db
    .prepare(
      `select last_seen_run, last_absent_run, suppressed_run, suppressed_reason
         from issue_detectors where issue_fp = ?`,
    )
    .all(fingerprint) as unknown as DetectorSuppressionRow[]

  const verdict = issueSuppression(rows)
  db.prepare('update issues set suppressed_run = ?, suppressed_reason = ? where fingerprint = ?').run(
    verdict?.run ?? null,
    verdict?.reason ?? null,
    fingerprint,
  )
}

interface CandidateRow {
  fingerprint: string
  state: IssueState
}

/**
 * A tool's reconciliation scope. `detects` is a declaration and declarations go
 * stale, so it is unioned with every class this tool has actually produced for
 * this skill. Revision 2 unioned only `unmapped:` classes, which left a merely
 * incomplete `detects` just as unclosable.
 */
function scopeFor(db: DatabaseSync, skillId: string, toolId: string): Set<string> {
  const declared = getAdapter(toolId)?.manifest.detects ?? []
  const produced = db
    .prepare(
      `select distinct i.rule_class as rule_class
         from issues i
         join issue_detectors d on d.issue_fp = i.fingerprint
        where i.skill_id = ? and d.tool_id = ?`,
    )
    .all(skillId, toolId) as Array<{ rule_class: string }>
  return new Set<string>([...declared, ...produced.map((r) => r.rule_class)])
}

/**
 * Two phases: each conclusive tool records what it did and did not see, then an
 * issue closes only when every tool that has ever detected it agrees it is gone.
 *
 * Closure is a conjunction over a set, and a set has no order — which is the
 * point. Revision 2 asked which tool detected an issue "most recently", but
 * fan-out tools run concurrently, so two detections from one run had no defined
 * order and completion timing decided whether the issue closed.
 *
 * Tool runs that errored or were skipped are excluded from both phases, which
 * is what stops a crashed scanner from marking everything it ever found as fixed.
 */
export function reconcile(
  db: DatabaseSync,
  skillId: string,
  runId: string,
  toolRuns: readonly ReconcileToolRun[],
): number {
  // Every fingerprint phase 1 wrote a detector row for, so phase 3 recomputes
  // exactly what could have changed.
  const touched = new Set<string>()

  // Phase 1: per-tool evidence. An errored or skipped run `continue`s before
  // either write, which is what extends the existing fail-safe to suppression:
  // both columns keep whatever the last conclusive run left there.
  for (const toolRun of toolRuns) {
    if (toolRun.outcome !== 'passed' && toolRun.outcome !== 'failed') continue

    for (const fp of toolRun.reported) {
      // The suppression pair is bound in the same statement that advances
      // `last_seen_run`, to null when the sighting was not suppressed. The
      // clear is therefore structural: there is no separate path to forget.
      const reason = toolRun.suppressed.get(fp)
      db.prepare(
        `insert into issue_detectors (issue_fp, tool_id, last_seen_run,
                                      suppressed_run, suppressed_reason)
              values (?, ?, ?, ?, ?)
         on conflict(issue_fp, tool_id) do update set
              last_seen_run     = excluded.last_seen_run,
              suppressed_run    = excluded.suppressed_run,
              suppressed_reason = excluded.suppressed_reason`,
      ).run(
        fp,
        toolRun.toolId,
        runId,
        reason === undefined ? null : runId,
        reason === undefined ? null : reason,
      )
      touched.add(fp)
    }

    const scope = scopeFor(db, skillId, toolRun.toolId)
    if (scope.size === 0) continue
    const placeholders = [...scope].map(() => '?').join(',')

    const known = db
      .prepare(
        `select i.fingerprint as fingerprint
           from issues i
           join issue_detectors d on d.issue_fp = i.fingerprint and d.tool_id = ?
          where i.skill_id = ? and i.rule_class in (${placeholders})`,
      )
      .all(toolRun.toolId, skillId, ...([...scope] as never[])) as Array<{ fingerprint: string }>

    for (const row of known) {
      if (toolRun.reported.has(row.fingerprint)) continue
      // Nulled here too, so a detector row reads honestly on its own rather
      // than carrying a suppression from a sighting it has since retracted.
      db.prepare(
        `update issue_detectors
            set last_absent_run = ?, suppressed_run = null, suppressed_reason = null
          where issue_fp = ? and tool_id = ?`,
      ).run(runId, row.fingerprint, toolRun.toolId)
      touched.add(row.fingerprint)
    }
  }

  // Phase 2: close only where every detector agrees.
  let closed = 0
  const candidates = db
    .prepare(
      `select fingerprint, state from issues
        where skill_id = ? and state in ('open', 'acknowledged')`,
    )
    .all(skillId) as unknown as CandidateRow[]

  for (const candidate of candidates) {
    const detectors = db
      .prepare(`select last_seen_run, last_absent_run from issue_detectors where issue_fp = ?`)
      .all(candidate.fingerprint) as Array<{
      last_seen_run: string | null
      last_absent_run: string | null
    }>
    if (detectors.length === 0) continue

    const allAbsent = detectors.every(detectorSaysGone)
    if (!allAbsent) continue

    const next = stateOnAbsence(candidate.state)
    if (!next) continue
    db.prepare(
      `update issues set state = ?, closed_run = ?, reopened_run = null where fingerprint = ?`,
    ).run(next, runId, candidate.fingerprint)
    closed += 1
  }

  // Phase 3: the issue-level cache. Over every fingerprint phase 1 touched, not
  // only phase 2's open/acknowledged candidates — restricting it would freeze a
  // `wontfix` issue's flag forever, and `wontfix` rows are on the Issues screen.
  for (const fp of touched) recomputeIssueSuppression(db, fp)

  return closed
}
