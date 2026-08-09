import type { DatabaseSync } from 'node:sqlite'
import type { Stage } from '../types.js'

/** R9.8's three. optimise and release are not gates and never authorise one. */
export const GATE_STAGES: readonly Stage[] = ['validate', 'evaluate', 'security']

export interface GateOutcome {
  stage: Stage
  outcome: string
  /** R9.9's binding: the bytes this gate actually ran against. */
  skillDigest: string
  runId: string
  sidecarPath: string
}

/**
 * §8.2's two outcomes that mean `ran == 0`: not one tool in the stage reached a
 * verdict, so the stage says nothing about the skill. `degraded` is absent
 * deliberately — some of its tools did run, and one of them may have failed.
 */
const NO_VERDICT: ReadonlySet<string> = new Set(['errored', 'skipped'])

/**
 * The most recent run per gate stage *that reached a verdict*. Ordered by run
 * id, not by timestamp: UUIDv7 is ordered by claim, which is the same field
 * `latest` uses, so two runs finishing out of order still agree on which
 * evidence is newer.
 *
 * A stage that reached no verdict is stepped over rather than reported, for the
 * reason §8.1 gives for keeping the same rows out of reconciliation: a crashed,
 * cancelled or absent tool must not overwrite what a completed one established.
 * Cancelling evaluate 22s into a re-run used to supersede the pass recorded
 * against the same bytes minutes earlier, and §12.4 then refused every release
 * after it (runs `019fe5af`–`019fe5c3`). Safe only because R9.9 binds the
 * outcome to a digest: after the bytes move, the last verdict is against the
 * old ones and the digest check refuses.
 */
export function latestGateOutcomes(db: DatabaseSync, skillId: string): GateOutcome[] {
  const rows = db
    .prepare(
      `select s.stage as stage, s.outcome as outcome, r.skill_digest as digest,
              r.id as run_id, r.sidecar_path as sidecar
         from stages s
         join runs r on r.id = s.run_id
        where r.skill_id = ? and s.stage in ('validate', 'evaluate', 'security')
        order by r.id desc, s.id desc`,
    )
    .all(skillId) as Array<{
    stage: string
    outcome: string
    digest: string
    run_id: string
    sidecar: string
  }>

  const seen = new Map<string, GateOutcome>()
  for (const row of rows) {
    if (seen.has(row.stage) || NO_VERDICT.has(row.outcome)) continue
    seen.set(row.stage, {
      stage: row.stage as Stage,
      outcome: row.outcome,
      skillDigest: row.digest,
      runId: row.run_id,
      sidecarPath: row.sidecar,
    })
  }
  return [...seen.values()]
}
