import type { DatabaseSync } from 'node:sqlite'
import { getAdapter } from '../adapters/registry.js'
import type { ToolOutcome } from '../types.js'
import { type IssueState, stateOnAbsence } from './issues.js'

export interface ReconcileToolRun {
  toolRunId: number
  toolId: string
  outcome: ToolOutcome
  /** Fingerprints this tool run reported. */
  reported: ReadonlySet<string>
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
  // Phase 1: per-tool evidence.
  for (const toolRun of toolRuns) {
    if (toolRun.outcome !== 'passed' && toolRun.outcome !== 'failed') continue

    for (const fp of toolRun.reported) {
      db.prepare(
        `insert into issue_detectors (issue_fp, tool_id, last_seen_run)
              values (?, ?, ?)
         on conflict(issue_fp, tool_id) do update set last_seen_run = excluded.last_seen_run`,
      ).run(fp, toolRun.toolId, runId)
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
      db.prepare(
        `update issue_detectors set last_absent_run = ? where issue_fp = ? and tool_id = ?`,
      ).run(runId, row.fingerprint, toolRun.toolId)
    }
  }

  // Phase 2: close only where every detector agrees.
  let closed = 0
  const candidates = db
    .prepare(
      `select fingerprint, state from issues
        where skill_id = ? and state in ('open', 'acknowledged')`,
    )
    .all(skillId) as CandidateRow[]

  for (const candidate of candidates) {
    const detectors = db
      .prepare(`select last_seen_run, last_absent_run from issue_detectors where issue_fp = ?`)
      .all(candidate.fingerprint) as Array<{
      last_seen_run: string | null
      last_absent_run: string | null
    }>
    if (detectors.length === 0) continue

    // Run ids are UUIDv7, so lexical order is claim order.
    const allAbsent = detectors.every(
      (d) =>
        d.last_absent_run !== null &&
        (d.last_seen_run === null || d.last_absent_run > d.last_seen_run),
    )
    if (!allAbsent) continue

    const next = stateOnAbsence(candidate.state)
    if (!next) continue
    db.prepare(
      `update issues set state = ?, closed_run = ?, reopened_run = null where fingerprint = ?`,
    ).run(next, runId, candidate.fingerprint)
    closed += 1
  }

  return closed
}
