import { openLedger, retireSkill, syncLifecycle } from '../core/index.js'
import { detectInterrupted } from './recover-command.js'
import { discoverAll, selectSkill, type CliDeps } from './run-command.js'

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
  const { config, skill } = await selectSkill(deps.home, selector)

  const result = await retireSkill({
    skill,
    deprecated: opts.undo !== true,
    // Design §12.2: a new mutating run against a skill holding an unresolved
    // record refuses, and retirement is a mutation. Only release consulted this
    // before, which let a crashed retire be retried and then rolled back over
    // the retry's applied bytes.
    interrupted: (await detectInterrupted(deps.home)).some((item) => item.skillId === skill.id),
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

  if (!result.applied) {
    // `retireSkill` returns before ever calling `confirm` when the skill is
    // already in the requested state (retire.ts's empty-change-set branch),
    // which an empty scope is the only way to tell apart from a declined
    // confirmation — both share `applied: false`. Conflating the two would
    // make "nothing to do" fail a script the same way a real refusal does.
    if (result.scope.length === 0) {
      const line = `${skill.id} is already in that state`
      deps.write(opts.json ? JSON.stringify({ type: 'retire:noop', skill: skill.id, message: line }) : line)
      return 0
    }
    return 1
  }

  // §13: the file is the authority; the cache follows. A skill's frontmatter
  // just changed underneath the discovery this command started with, so this
  // is a second, deliberate re-read — not a duplicate to fold away — and it is
  // what lets a user who never runs another gate still see the right state.
  const ledger = openLedger(deps.dbPath)
  try {
    syncLifecycle(ledger.db, await discoverAll(config))
  } finally {
    ledger.close()
  }

  const line = opts.undo === true ? `reinstated ${skill.id}` : `retired ${skill.id}`
  deps.write(opts.json ? JSON.stringify({ type: 'retire:done', skill: skill.id, message: line }) : line)
  return 0
}
