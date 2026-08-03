import {
  forgetInterrupted,
  loadConfig,
  restoreInterrupted,
  scanInterrupted,
  type InterruptedMutation,
} from '../core/index.js'
import { discoverAll, type CliDeps } from './run-command.js'

export async function detectInterrupted(home: string): Promise<InterruptedMutation[]> {
  return scanInterrupted(await discoverAll(await loadConfig(home)))
}

/**
 * R10.10's offer. Printed on every launch and never blocking one: an old marker
 * the user has decided to leave alone must not make the tool unusable. What
 * does block is a new mutating run against the same skill, which the release
 * stage refuses.
 */
export function formatInterrupted(found: readonly InterruptedMutation[]): string[] {
  return found.map(
    (item) =>
      `interrupted ${item.record.stage} on ${item.skillId} (${item.record.runId}, ` +
      `${item.record.strategy}${item.journalIncomplete ? ', apply incomplete' : ''}) — ` +
      `skillgantry recover --restore ${item.record.runId}`,
  )
}

/**
 * Returns the *current* state (a fresh scan after the requested action, when
 * one runs), not the snapshot `found` was read from — a programmatic caller
 * acting on the return value would otherwise see a record this call itself
 * just settled as still `active`.
 */
export async function runRecover(
  deps: CliDeps,
  opts: { restore?: string; forget?: string; json?: boolean },
): Promise<InterruptedMutation[]> {
  if (opts.restore !== undefined && opts.forget !== undefined) {
    throw new Error('pass either --restore or --forget, not both')
  }

  const found = await detectInterrupted(deps.home)

  const target = opts.restore ?? opts.forget
  if (target !== undefined) {
    const item = found.find((candidate) => candidate.record.runId === target)
    if (!item) throw new Error(`no interrupted mutation with run id ${target}`)
    if (opts.restore !== undefined) {
      const outcome = await restoreInterrupted(item)
      // Three distinct states, not two. The `settled-applied` branch is a
      // *completed* apply — the tree holds the bytes the user approved — so
      // saying "never modified" there was a false statement on the one command
      // a user reaches after a crash.
      deps.write(
        outcome.action === 'settled-applied'
          ? `the apply for ${item.record.runId} had already completed; recorded it as applied and left the working tree as it stands`
          : outcome.action === 'pruned'
            ? `pruned the sandbox for ${item.record.runId}; the working tree was never modified`
            : `restored ${outcome.paths.length} path(s): ${outcome.paths.join(', ')}`,
      )
    } else {
      await forgetInterrupted(item)
      deps.write(`forgot ${item.record.runId}; the working tree is unchanged`)
    }
    return detectInterrupted(deps.home)
  }

  if (opts.json) {
    deps.write(JSON.stringify(found))
    return found
  }
  if (found.length === 0) {
    deps.write('no interrupted mutation')
    return found
  }
  for (const line of formatInterrupted(found)) deps.write(line)
  return found
}
