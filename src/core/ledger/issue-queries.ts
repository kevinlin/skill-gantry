import type { DatabaseSync } from 'node:sqlite'
import type { Severity } from '../types.js'
import { runDirOf } from '../workspace/layout.js'
import {
  detectorSaysGone,
  type IssueAction,
  type IssueState,
  stateOnUserAction,
} from './issues.js'

export interface IssueFilter {
  skillId?: string
  repoId?: string
  /** Omitted means every state; `open` alone is the common triage view. */
  state?: IssueState
  ruleClass?: string
  severity?: Severity
  /**
   * R8.15. Omitted means both, so the Issues screen keeps showing suppressed
   * rows — hiding a suppression on the audit surface makes it unfalsifiable.
   */
  suppressed?: boolean
}

export interface IssueRow {
  fingerprint: string
  skillId: string
  repoId: string
  ruleClass: string
  relPath: string
  severity: Severity
  state: IssueState
  occurrenceCount: number
  /** Every tool that has ever detected it, sorted. */
  detectors: string[]
  /** Those that have not since reported a conclusive absence — R8.8's blockers. */
  blockedBy: string[]
  /** The identity, which every comparison and join still orders on — R6.7. */
  lastSeenRun: string | null
  /**
   * R6.1: the same run's directory name, which is what a surface shows a user.
   * Null when the run has no row left to name it, never when it has one.
   */
  lastSeenRunDir: string | null
  /** R8.15: every tool still reporting it reports it suppressed. */
  suppressed: boolean
  /** The tool's own justification, or null when not suppressed. */
  suppressionReason: string | null
}

const SEVERITY_SQL = `case i.severity_max
    when 'critical' then 5 when 'high' then 4 when 'medium' then 3
    when 'low' then 2 else 1 end`

export function listIssues(db: DatabaseSync, filter: IssueFilter): IssueRow[] {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.skillId !== undefined) {
    clauses.push('i.skill_id = ?')
    params.push(filter.skillId)
  }
  if (filter.repoId !== undefined) {
    clauses.push('k.repo_id = ?')
    params.push(filter.repoId)
  }
  if (filter.state !== undefined) {
    clauses.push('i.state = ?')
    params.push(filter.state)
  }
  if (filter.ruleClass !== undefined) {
    clauses.push('i.rule_class = ?')
    params.push(filter.ruleClass)
  }
  if (filter.severity !== undefined) {
    clauses.push('i.severity_max = ?')
    params.push(filter.severity)
  }
  if (filter.suppressed !== undefined) {
    clauses.push(`i.suppressed_run is ${filter.suppressed ? 'not null' : 'null'}`)
  }

  const rows = db
    .prepare(
      `select i.fingerprint as fingerprint, i.skill_id as skillId, k.repo_id as repoId,
              i.rule_class as ruleClass, i.rel_path as relPath,
              i.severity_max as severity, i.state as state,
              i.occurrence_count as occurrenceCount, i.last_seen_run as lastSeenRun,
              r.sidecar_path as lastSeenRunDir,
              i.suppressed_run is not null as suppressed,
              i.suppressed_reason as suppressionReason
         from issues i join skills k on k.id = i.skill_id
         -- Left, so an issue whose run row is gone still reports the sighting it
         -- has: an inner join would silently drop the row from the audit surface.
         left join runs r on r.id = i.last_seen_run
        where 1 = 1 ${clauses.length === 0 ? '' : `and ${clauses.join(' and ')}`}
        -- Suppressed last, not hidden: a decided issue should not head the
        -- triage list, but the audit surface must still carry it (R8.15).
        order by (i.suppressed_run is not null), ${SEVERITY_SQL} desc,
                 i.skill_id, i.rel_path, i.rule_class`,
    )
    .all(...params) as unknown as Array<
    Omit<IssueRow, 'detectors' | 'blockedBy' | 'suppressed'> & { suppressed: number }
  >

  if (rows.length === 0) return []

  // One query for every row's detectors rather than one per row: an Issues
  // screen over a few hundred issues would otherwise open a few hundred
  // statements to draw one frame.
  const detectorRows = db
    .prepare(
      `select issue_fp as fp, tool_id as toolId, last_seen_run, last_absent_run
         from issue_detectors
        where issue_fp in (${rows.map(() => '?').join(',')})
        order by tool_id`,
    )
    .all(...rows.map((row) => row.fingerprint)) as Array<{
    fp: string
    toolId: string
    last_seen_run: string | null
    last_absent_run: string | null
  }>

  return rows.map((row) => {
    const mine = detectorRows.filter((detector) => detector.fp === row.fingerprint)
    return {
      ...row,
      // The column selected into this field is the run's whole `sidecar_path`.
      lastSeenRunDir: row.lastSeenRunDir === null ? null : runDirOf(row.lastSeenRunDir),
      // SQLite has no boolean type, so the projected 0/1 is narrowed here
      // rather than leaking a number through `IssueRow`.
      suppressed: row.suppressed === 1,
      detectors: mine.map((detector) => detector.toolId),
      blockedBy: mine.filter((detector) => !detectorSaysGone(detector)).map((d) => d.toolId),
    }
  })
}

export interface DetectionRule {
  toolId: string
  nativeRuleId: string
  relPath: string
}

/**
 * The native rule ids one issue was reported under, restricted to its
 * `last_seen_run`. All of history would add a rule for a rule id reported once
 * and not since — a suppression for a finding that no longer exists.
 */
export function issueDetectionRules(db: DatabaseSync, fingerprint: string): DetectionRule[] {
  return db
    .prepare(
      `select distinct tr.tool_id as toolId, d.native_rule_id as nativeRuleId, i.rel_path as relPath
         from issue_detections d
         join tool_runs tr on tr.id = d.tool_run_id
         join stages s on s.id = tr.stage_id
         join issues i on i.fingerprint = d.issue_fp
        where d.issue_fp = ? and s.run_id = i.last_seen_run
        order by tr.tool_id, d.native_rule_id`,
    )
    .all(fingerprint) as unknown as DetectionRule[]
}

/**
 * R8.10's user transitions. Returns the new state, or null when the action is
 * not legal from the issue's current state, in which case nothing is written.
 */
export function setIssueState(
  db: DatabaseSync,
  fingerprint: string,
  action: IssueAction,
  note?: string,
): IssueState | null {
  const current = db.prepare('select state from issues where fingerprint = ?').get(fingerprint) as
    | { state: IssueState }
    | undefined
  if (current === undefined) return null

  const next = stateOnUserAction(current.state, action)
  if (next === null) return null

  // closed_run is cleared on reopen for the same reason `recordRun` clears it
  // on a redetection: a row that is `open` while still naming the run that
  // closed it makes "when was this last closed" unanswerable.
  db.prepare(
    `update issues
        set state = ?,
            note = coalesce(?, note),
            closed_run = case when ? = 'open' then null else closed_run end
      where fingerprint = ?`,
  ).run(next, note ?? null, next, fingerprint)
  return next
}
