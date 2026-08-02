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
 * The most recent run per gate stage. Ordered by run id, not by timestamp:
 * UUIDv7 is ordered by claim, which is the same field `latest` uses, so two runs
 * finishing out of order still agree on which evidence is newer.
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
    if (seen.has(row.stage)) continue
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
