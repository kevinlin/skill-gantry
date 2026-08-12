import type { DatabaseSync } from 'node:sqlite'
import type { Severity, Stage } from '../types.js'
import { STAGE_ORDER, runDirOf } from '../workspace/layout.js'
import type { ProvenanceLike } from './fingerprint.js'

export interface StatsFilter {
  skillId?: string
  repoId?: string
  /** R7.6. */
  provenanceFp?: string
}

export interface StagePassRate {
  stage: Stage
  runs: number
  passed: number
  /** 0–1. `runs` is always > 0 for a row that exists, so this never divides by zero. */
  rate: number
}

export interface StageWallClock {
  stage: Stage
  runs: number
  medianMs: number | null
  maxMs: number | null
}

export interface EvalCaseRate {
  casesTotal: number
  casesPassed: number
  casesErrored: number
  /** null when no evaluate stage has recorded a case, which is not the same as 0. */
  rate: number | null
}

export interface SeverityCount {
  severity: Severity
  count: number
}

export interface RuleClassCount {
  ruleClass: string
  count: number
}

export interface RunHistoryRow {
  runId: string
  /** R6.1: the run's directory name, which is how a surface names it. */
  runDir: string
  skillId: string
  repoId: string
  outcome: string
  startedAt: string
  endedAt: string | null
  provenanceFp: string | null
}

export interface ProvenanceOption {
  fingerprint: string
  baseUrlHost: string | null
  /** The first model mapping, which is what identifies a profile on one row. */
  model: string | null
  analysisModes: string
  runs: number
  firstSeen: string
  lastSeen: string
}

export interface DashboardStats {
  repos: number
  skills: number
  runs: number
  stagePassRates: StagePassRate[]
  wallClock: StageWallClock[]
  evalCases: EvalCaseRate
  openBySeverity: SeverityCount[]
  openByRuleClass: RuleClassCount[]
  /** Open or acknowledged, but suppressed by the skill's own file — R8.15. */
  openSuppressed: number
  history: RunHistoryRow[]
}

/** One filter, three narrowings, so "across every repo" is the same code path. */
function runScope(filter: StatsFilter): { sql: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (filter.skillId !== undefined) {
    clauses.push('r.skill_id = ?')
    params.push(filter.skillId)
  }
  if (filter.repoId !== undefined) {
    clauses.push('k.repo_id = ?')
    params.push(filter.repoId)
  }
  if (filter.provenanceFp !== undefined) {
    clauses.push('r.provenance_fp = ?')
    params.push(filter.provenanceFp)
  }
  return { sql: clauses.length === 0 ? '' : `and ${clauses.join(' and ')}`, params }
}

/**
 * An issue is not a run, so the provenance filter reaches it through its last
 * sighting: "issues as of the runs that used this provider". Dropping the
 * clause instead would show one provider's numbers beside every provider's
 * issues, which is the comparison R7.6 exists to make possible.
 */
function issueScope(filter: StatsFilter): { sql: string; params: string[] } {
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
  if (filter.provenanceFp !== undefined) {
    clauses.push(
      `exists (select 1 from runs r2
                where r2.id = i.last_seen_run and r2.provenance_fp = ?)`,
    )
    params.push(filter.provenanceFp)
  }
  return { sql: clauses.length === 0 ? '' : `and ${clauses.join(' and ')}`, params }
}

const STAGE_JOIN = `from stages s
   join runs r on r.id = s.run_id
   join skills k on k.id = r.skill_id
  where 1 = 1`

export function stagePassRates(db: DatabaseSync, filter: StatsFilter): StagePassRate[] {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select s.stage as stage, count(*) as runs,
              sum(case when s.outcome = 'passed' then 1 else 0 end) as passed
         ${STAGE_JOIN} ${scope.sql}
        group by s.stage`,
    )
    .all(...scope.params) as Array<{ stage: string; runs: number; passed: number }>

  return STAGE_ORDER.flatMap((stage) => {
    const row = rows.find((candidate) => candidate.stage === stage)
    return row === undefined
      ? []
      : [{ stage, runs: row.runs, passed: row.passed, rate: row.passed / row.runs }]
  })
}

/** Median in TypeScript: SQLite has no percentile function. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

export function stageWallClock(db: DatabaseSync, filter: StatsFilter): StageWallClock[] {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select s.stage as stage,
              cast(round((julianday(s.ended_at) - julianday(s.started_at)) * 86400000) as integer) as ms
         ${STAGE_JOIN}
           and s.started_at is not null and s.ended_at is not null ${scope.sql}`,
    )
    .all(...scope.params) as Array<{ stage: string; ms: number }>

  return STAGE_ORDER.flatMap((stage) => {
    const durations = rows.filter((row) => row.stage === stage).map((row) => row.ms)
    return durations.length === 0
      ? []
      : [
          {
            stage,
            runs: durations.length,
            medianMs: median(durations),
            maxMs: Math.max(...durations),
          },
        ]
  })
}

export function evalCaseRate(db: DatabaseSync, filter: StatsFilter): EvalCaseRate {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select s.metrics_json as metrics
         ${STAGE_JOIN} and s.stage = 'evaluate' ${scope.sql}`,
    )
    .all(...scope.params) as Array<{ metrics: string | null }>

  const total = { casesTotal: 0, casesPassed: 0, casesErrored: 0 }
  for (const row of rows) {
    // Summed here rather than in SQL: the metric key set is a closed union in
    // one place (R1.5), and `json_extract` per key would be a second list of it.
    let metrics: Record<string, number> = {}
    try {
      metrics = (JSON.parse(row.metrics ?? '{}') ?? {}) as Record<string, number>
    } catch {
      continue
    }
    total.casesTotal += metrics.casesTotal ?? 0
    total.casesPassed += metrics.casesPassed ?? 0
    total.casesErrored += metrics.casesErrored ?? 0
  }
  return {
    ...total,
    rate: total.casesTotal === 0 ? null : total.casesPassed / total.casesTotal,
  }
}

const OPEN_STATES = `i.state in ('open', 'acknowledged')`

/**
 * R8.15. An issue the user has baselined is one they have decided about, so it
 * leaves the counts — otherwise the Dashboard's open number could never fall
 * for anyone who uses a suppression file, which is that number's entire job.
 * It is reported separately rather than dropped, and `listIssues` still lists it.
 */
export function openIssueCounts(
  db: DatabaseSync,
  filter: StatsFilter,
): { bySeverity: SeverityCount[]; byRuleClass: RuleClassCount[]; suppressed: number } {
  const scope = issueScope(filter)
  const base = `from issues i join skills k on k.id = i.skill_id where ${OPEN_STATES} ${scope.sql}`
  const join = `${base} and i.suppressed_run is null`

  const bySeverity = db
    .prepare(
      `select i.severity_max as severity, count(*) as count ${join}
        group by i.severity_max
        order by case i.severity_max
                   when 'critical' then 5 when 'high' then 4 when 'medium' then 3
                   when 'low' then 2 else 1 end desc`,
    )
    .all(...scope.params) as unknown as SeverityCount[]

  const byRuleClass = db
    .prepare(
      `select i.rule_class as ruleClass, count(*) as count ${join}
        group by i.rule_class order by count desc, i.rule_class`,
    )
    .all(...scope.params) as unknown as RuleClassCount[]

  const { n } = db
    .prepare(`select count(*) as n ${base} and i.suppressed_run is not null`)
    .get(...scope.params) as { n: number }

  return { bySeverity, byRuleClass, suppressed: n }
}

export function runHistory(db: DatabaseSync, filter: StatsFilter, limit = 20): RunHistoryRow[] {
  const scope = runScope(filter)
  const rows = db
    .prepare(
      `select r.id as runId, r.sidecar_path as runDir, r.skill_id as skillId,
              k.repo_id as repoId,
              r.outcome as outcome, r.started_at as startedAt, r.ended_at as endedAt,
              r.provenance_fp as provenanceFp
         from runs r join skills k on k.id = r.skill_id
        where 1 = 1 ${scope.sql}
        -- Ordered on the id and not the directory name: two runs starting in one
        -- second share that name, and the id cannot tie (R6.7).
        order by r.id desc limit ?`,
    )
    .all(...scope.params, limit) as unknown as RunHistoryRow[]
  return rows.map((row) => ({ ...row, runDir: runDirOf(row.runDir) }))
}

export function provenanceOptions(db: DatabaseSync): ProvenanceOption[] {
  const rows = db
    .prepare(
      `select provenance_fp as fingerprint, count(*) as runs,
              min(started_at) as firstSeen, max(started_at) as lastSeen,
              max(provenance_json) as sample
         from runs where provenance_fp is not null
        group by provenance_fp order by runs desc, lastSeen desc`,
    )
    .all() as Array<{
    fingerprint: string
    runs: number
    firstSeen: string
    lastSeen: string
    sample: string | null
  }>

  return rows.map((row) => {
    let parsed: ProvenanceLike = {}
    try {
      parsed = (JSON.parse(row.sample ?? '{}') ?? {}) as ProvenanceLike
    } catch {
      parsed = {}
    }
    const models = Object.values(parsed.models ?? {}).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    const modes = Object.entries(parsed.analysisModes ?? {})
      .map(([toolId, mode]) => `${toolId}:${mode}`)
      .sort()
      .join(' ')
    return {
      fingerprint: row.fingerprint,
      baseUrlHost: parsed.baseUrlHost ?? null,
      model: models[0] ?? null,
      analysisModes: modes,
      runs: row.runs,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    }
  })
}

export function dashboard(
  db: DatabaseSync,
  filter: StatsFilter,
  historyLimit = 20,
): DashboardStats {
  const scope = runScope(filter)
  const counts = db
    .prepare(
      `select count(distinct k.repo_id) as repos, count(distinct r.skill_id) as skills,
              count(*) as runs
         from runs r join skills k on k.id = r.skill_id
        where 1 = 1 ${scope.sql}`,
    )
    .get(...scope.params) as { repos: number; skills: number; runs: number }
  const open = openIssueCounts(db, filter)

  return {
    ...counts,
    stagePassRates: stagePassRates(db, filter),
    wallClock: stageWallClock(db, filter),
    evalCases: evalCaseRate(db, filter),
    openBySeverity: open.bySeverity,
    openByRuleClass: open.byRuleClass,
    openSuppressed: open.suppressed,
    history: runHistory(db, filter, historyLimit),
  }
}
