import {
  discoverSkills,
  forgetInterrupted,
  loadConfig,
  restoreInterrupted,
  scanInterrupted,
  type InterruptedMutation,
  type SkillRef,
} from '../core/index.js'
import type { CliDeps } from './run-command.js'

export async function detectInterrupted(home: string): Promise<InterruptedMutation[]> {
  const config = await loadConfig(home)
  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))
  return scanInterrupted(skills)
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

export async function runRecover(
  deps: CliDeps,
  opts: { restore?: string; forget?: string; json?: boolean },
): Promise<InterruptedMutation[]> {
  const found = await detectInterrupted(deps.home)

  const target = opts.restore ?? opts.forget
  if (target !== undefined) {
    const item = found.find((candidate) => candidate.record.runId === target)
    if (!item) throw new Error(`no interrupted mutation with run id ${target}`)
    if (opts.restore !== undefined) {
      const restored = await restoreInterrupted(item)
      deps.write(
        restored.length > 0
          ? `restored ${restored.length} path(s): ${restored.join(', ')}`
          : `pruned the sandbox for ${item.record.runId}; the working tree was never modified`,
      )
    } else {
      await forgetInterrupted(item)
      deps.write(`forgot ${item.record.runId}; the working tree is unchanged`)
    }
    return found
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
