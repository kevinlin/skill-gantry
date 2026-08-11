import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpgradeState } from './types.js'

const stateFile = (home: string): string => join(home, 'upgrade.json')

/**
 * `null` for absent *and* for unparseable. This file is a cache: a corrupt one
 * costs a network request, and throwing from it would make a stray byte in
 * `~/.skillgantry` the reason a launch fails.
 */
export async function loadUpgradeState(home: string): Promise<UpgradeState | null> {
  try {
    return JSON.parse(await readFile(stateFile(home), 'utf8')) as UpgradeState
  } catch {
    return null
  }
}

export async function saveUpgradeState(home: string, state: UpgradeState): Promise<void> {
  await mkdir(home, { recursive: true })
  await writeFile(stateFile(home), `${JSON.stringify(state, null, 2)}\n`)
}
