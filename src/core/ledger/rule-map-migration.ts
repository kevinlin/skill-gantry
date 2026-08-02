import type { DatabaseSync } from 'node:sqlite'
import { RULE_CLASS_MAP_VERSION, classifyRule } from '../adapters/rule-classes.js'
import type { RuleClass, Severity } from '../types.js'
import { fingerprint } from './fingerprint.js'
import { type IssueState, maxSeverity } from './issues.js'

export interface RuleMapMigrationResult {
  applied: number
  /** Issues whose new fingerprint was free: rewritten in place. */
  reclassified: number
  /** Issues whose new fingerprint already existed: folded into it. */
  merged: number
}

/** wontfix suppresses, acknowledged is triaged, open is live, fixed is closed. */
const STATE_RANK: Readonly<Record<IssueState, number>> = {
  wontfix: 4,
  acknowledged: 3,
  open: 2,
  fixed: 1,
}

const strongestState = (a: IssueState, b: IssueState): IssueState =>
  STATE_RANK[a] >= STATE_RANK[b] ? a : b

/** `null` sorts before any run id; run ids are UUIDv7, so lexical order is claim order. */
const laterRun = (a: string | null, b: string | null): string | null => {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

const earlierRun = (a: string | null, b: string | null): string | null => {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}

export function appliedRuleMapVersion(db: DatabaseSync): number {
  const row = db.prepare('select max(version) as v from rule_map_migrations').get() as
    | { v: number | null }
    | undefined
  return row?.v ?? 1
}

interface IssueRow {
  fingerprint: string
  skill_id: string
  rule_class: string
  rel_path: string
  severity_max: Severity
  state: IssueState
  occurrence_count: number
  first_seen_run: string | null
  last_seen_run: string | null
  note: string | null
}

/**
 * Re-parents every child row of `from` onto `to`, then deletes `from`.
 *
 * Detection ordinals are rebased rather than copied: two issues that merge can
 * each hold an ordinal 0 for the same tool run, and (issue_fp, tool_run_id,
 * ordinal) is the primary key. Rebasing is why R8.13's "one row per occurrence"
 * survives a merge instead of losing a row to a constraint violation.
 */
function fold(db: DatabaseSync, from: string, to: string): void {
  const runs = db
    .prepare('select distinct tool_run_id as id from issue_detections where issue_fp = ?')
    .all(from) as Array<{ id: number }>

  for (const { id } of runs) {
    const top = db
      .prepare(
        'select coalesce(max(ordinal), -1) as m from issue_detections where issue_fp = ? and tool_run_id = ?',
      )
      .get(to, id) as { m: number }
    db.prepare(
      `update issue_detections set issue_fp = ?, ordinal = ordinal + ?
        where issue_fp = ? and tool_run_id = ?`,
    ).run(to, top.m + 1, from, id)
  }

  const detectors = db
    .prepare('select tool_id, last_seen_run, last_absent_run from issue_detectors where issue_fp = ?')
    .all(from) as Array<{ tool_id: string; last_seen_run: string | null; last_absent_run: string | null }>

  for (const d of detectors) {
    const existing = db
      .prepare('select last_seen_run, last_absent_run from issue_detectors where issue_fp = ? and tool_id = ?')
      .get(to, d.tool_id) as { last_seen_run: string | null; last_absent_run: string | null } | undefined

    if (existing) {
      db.prepare(
        'update issue_detectors set last_seen_run = ?, last_absent_run = ? where issue_fp = ? and tool_id = ?',
      ).run(
        laterRun(existing.last_seen_run, d.last_seen_run),
        laterRun(existing.last_absent_run, d.last_absent_run),
        to,
        d.tool_id,
      )
    } else {
      db.prepare(
        'insert into issue_detectors (issue_fp, tool_id, last_seen_run, last_absent_run) values (?, ?, ?, ?)',
      ).run(to, d.tool_id, d.last_seen_run, d.last_absent_run)
    }
  }

  db.prepare('delete from issue_detectors where issue_fp = ?').run(from)
  db.prepare('delete from issues where fingerprint = ?').run(from)
}

/**
 * Applies the shipped rule-class map version to a ledger written under an
 * earlier one. Never called from openLedger: R8.14 requires the migration to be
 * explicit, so the trigger is `skillgantry doctor --migrate-rule-map`.
 *
 * One transaction, because a half-applied migration leaves issues whose
 * fingerprint no longer matches their rule class, and nothing would ever
 * recompute them.
 */
export function migrateRuleMap(db: DatabaseSync): RuleMapMigrationResult {
  const from = appliedRuleMapVersion(db)
  if (from >= RULE_CLASS_MAP_VERSION) {
    return { applied: from, reclassified: 0, merged: 0 }
  }

  const note = `rule-map v${from} -> v${RULE_CLASS_MAP_VERSION}`
  let reclassified = 0
  let merged = 0

  db.exec('begin')
  try {
    const stale = db
      .prepare(`select * from issues where rule_class like 'unmapped:%'`)
      .all() as unknown as IssueRow[]

    for (const issue of stale) {
      // `unmapped:<toolId>:<nativeRuleId>` — the native id may itself contain
      // a colon, so split on the first two only.
      const [, toolId, ...rest] = issue.rule_class.split(':')
      const nativeRuleId = rest.join(':')
      if (!toolId || nativeRuleId === '') continue

      const next: RuleClass = classifyRule(toolId, nativeRuleId)
      if (next === issue.rule_class) continue

      const newFp = fingerprint(issue.skill_id, issue.rel_path, next)
      const target = db
        .prepare('select * from issues where fingerprint = ?')
        .get(newFp) as unknown as IssueRow | undefined

      if (target) {
        db.prepare(
          `update issues set state = ?, severity_max = ?, occurrence_count = ?,
                             first_seen_run = ?, last_seen_run = ?, note = ?
            where fingerprint = ?`,
        ).run(
          strongestState(target.state, issue.state),
          maxSeverity(target.severity_max, issue.severity_max),
          target.occurrence_count + issue.occurrence_count,
          earlierRun(target.first_seen_run, issue.first_seen_run),
          laterRun(target.last_seen_run, issue.last_seen_run),
          target.note ? `${target.note}; ${note}` : note,
          newFp,
        )
        fold(db, issue.fingerprint, newFp)
        merged += 1
      } else {
        // No collision: insert the new identity, move the children onto it,
        // then drop the old row. Inserting first matters because the child
        // tables carry `on delete cascade` — deleting the old row before its
        // rows had somewhere to go would take the detections with it.
        db.prepare(
          `insert into issues (fingerprint, skill_id, rule_class, rel_path, severity_max,
                               state, note, occurrence_count, first_seen_run, last_seen_run,
                               closed_run, reopened_run)
           select ?, skill_id, ?, rel_path, severity_max, state,
                  case when note is null then ? else note || '; ' || ? end,
                  occurrence_count, first_seen_run, last_seen_run, closed_run, reopened_run
             from issues where fingerprint = ?`,
        ).run(newFp, next, note, note, issue.fingerprint)
        db.prepare('update issue_detections set issue_fp = ? where issue_fp = ?')
          .run(newFp, issue.fingerprint)
        db.prepare('update issue_detectors set issue_fp = ? where issue_fp = ?')
          .run(newFp, issue.fingerprint)
        db.prepare('delete from issues where fingerprint = ?').run(issue.fingerprint)
        reclassified += 1
      }
    }

    db.prepare('insert into rule_map_migrations (version, note) values (?, ?)').run(
      RULE_CLASS_MAP_VERSION,
      `${note}: ${reclassified} reclassified, ${merged} merged`,
    )
    db.exec('commit')
  } catch (err) {
    db.exec('rollback')
    throw err
  }

  return { applied: RULE_CLASS_MAP_VERSION, reclassified, merged }
}
