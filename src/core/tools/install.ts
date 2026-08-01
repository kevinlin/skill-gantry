import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadToolLock, saveToolLock } from '../config/config.js'
import type { ToolLockEntry } from '../config/schema.js'
import { type UvInstallSpec, uvInstall } from './uv.js'

const run = promisify(execFile)

export const toolRoot = (home: string): string => join(home, 'tools')

const SEMVER = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

/**
 * An install that succeeds but leaves an unrunnable binary is the common
 * failure, so the lock entry is written only after the executable answers.
 */
export async function verifyTool(
  entry: Pick<ToolLockEntry, 'bin'>,
  versionArgv: string[],
): Promise<string> {
  let output: string
  try {
    const res = await run(entry.bin, versionArgv)
    output = `${res.stdout}${res.stderr}`
  } catch (err) {
    throw new Error(`${entry.bin} could not be invoked: ${(err as Error).message}`)
  }
  const match = SEMVER.exec(output)
  if (!match) throw new Error(`${entry.bin} could not be invoked: no version in ${output.trim()}`)
  return match[0]
}

export async function installAndLock(
  home: string,
  spec: UvInstallSpec,
  versionArgv: string[],
): Promise<ToolLockEntry> {
  const dir = join(toolRoot(home), spec.id)
  const bin = await uvInstall(dir, spec)
  const installedAt = new Date().toISOString()

  const resolvedVersion = await verifyTool({ bin }, versionArgv)

  const entry: ToolLockEntry = {
    installKind: 'uv-tool',
    requestedPin: spec.pin,
    resolvedVersion,
    bin,
    // uv verifies its own downloads against the index; there is nothing for us
    // to re-check. gh-release, which has no such guarantee, gains a declared
    // integrity source in M3.
    integrity: 'n/a',
    installedAt,
    verifiedAt: new Date().toISOString(),
  }

  const lock = await loadToolLock(home)
  await saveToolLock(home, { ...lock, tools: { ...lock.tools, [spec.id]: entry } })
  return entry
}
