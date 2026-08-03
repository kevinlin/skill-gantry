import {
  discoverSkills,
  loadConfig,
  openLedger,
  retireSkill,
  syncLifecycle,
} from '../core/index.js'
import { resolveSkill, type CliDeps } from './run-command.js'

export interface RetireOptions {
  undo?: boolean
  supersededBy?: string
  yes?: boolean
  json?: boolean
  allowDirty?: boolean
}

/**
 * R1.4 and design §13, driven through the CLI: retirement is not a stage, so
 * it does not run through `runPipeline`, but the write is still a mutation and
 * gets the same preview-then-confirm treatment as one.
 */
export async function runRetire(
  deps: CliDeps,
  selector: string,
  opts: RetireOptions,
): Promise<number> {
  const config = await loadConfig(deps.home)
  const allSkills = []
  for (const repo of config.repos) allSkills.push(...(await discoverSkills(repo)))
  const skill = resolveSkill(allSkills, selector)

  const result = await retireSkill({
    skill,
    deprecated: opts.undo !== true,
    ...(opts.supersededBy === undefined ? {} : { supersededBy: opts.supersededBy }),
    ...(opts.allowDirty === undefined ? {} : { allowDirty: opts.allowDirty }),
    // R5.2: the diff is emitted before the write in every mode, and `--yes` is
    // prior authorisation rather than permission to skip it.
    confirm: async (change) => {
      if (opts.json) {
        deps.write(
          JSON.stringify({
            type: 'mutation:pending',
            scope: change.entries.map((e) => e.path),
            diff: change.unifiedDiff,
          }),
        )
      } else {
        deps.write(change.unifiedDiff)
      }
      if (opts.yes === true) return true
      deps.write('retirement needs --yes')
      return false
    },
  })

  if (!result.applied) return 1

  // §13: the file is the authority; the cache follows. Reconciling here means a
  // user who never runs another gate still sees the right state in the ledger.
  const ledger = openLedger(deps.dbPath)
  try {
    const skills = []
    for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
    syncLifecycle(ledger.db, skills)
  } finally {
    ledger.close()
  }

  deps.write(opts.undo === true ? `reinstated ${skill.id}` : `retired ${skill.id}`)
  return 0
}
