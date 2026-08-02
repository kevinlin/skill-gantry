import type { DatabaseSync } from 'node:sqlite'
import type { SkillRef } from '../types.js'

export type LifecycleState = 'active' | 'deprecated'

/**
 * The ledger's copy of a lifecycle state. It is a cache, not the truth: the file
 * mutation and this transaction cannot be made atomic, so R1.6 names the file as
 * the authority and leaves a divergence as drift to report.
 *
 * It still earns its place — the Issues and Dashboard screens filter deprecated
 * skills across every registered repo without reading 76 files.
 */
export function readLifecycleCache(db: DatabaseSync): Map<string, LifecycleState> {
  const rows = db.prepare('select id, lifecycle_state as state from skills').all() as Array<{
    id: string
    state: string
  }>
  return new Map(rows.map((row) => [row.id, row.state === 'deprecated' ? 'deprecated' : 'active']))
}

/**
 * Reconciles the cache to the files, so a stale ledger self-heals on the next
 * discovery rather than needing recovery. A skill the ledger has never seen is
 * left alone: a row with no run is not a cache miss, it is a skill nothing has
 * ever recorded, and inserting one here would put discovery's I/O upstream of
 * the ledger's foreign keys.
 */
export function syncLifecycle(
  db: DatabaseSync,
  skills: readonly SkillRef[],
): { reconciled: number } {
  const cache = readLifecycleCache(db)
  let reconciled = 0
  db.exec('begin')
  try {
    for (const skill of skills) {
      const cached = cache.get(skill.id)
      if (cached === undefined) continue
      const file: LifecycleState = skill.deprecated ? 'deprecated' : 'active'
      if (cached === file) continue
      db.prepare(
        `update skills
            set lifecycle_state = ?,
                deprecated_at = case when ? = 'deprecated' then datetime('now') else null end,
                superseded_by = ?
          where id = ?`,
      ).run(file, file, skill.supersededBy, skill.id)
      reconciled += 1
    }
    db.exec('commit')
  } catch (err) {
    db.exec('rollback')
    throw err
  }
  return { reconciled }
}
