import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadToolLock, saveToolLock } from '../config/config.js'
import type { ToolLockEntry } from '../config/schema.js'
import type { ToolSpec } from './catalogue.js'
import type { Exec } from './exec.js'
import { type GhReleaseOptions, ghReleaseInstall } from './gh-release.js'
import { npmInstall } from './npm.js'
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
  versionArgv: readonly string[],
): Promise<string> {
  let output: string
  try {
    const res = await run(entry.bin, [...versionArgv])
    output = `${res.stdout}${res.stderr}`
  } catch (err) {
    throw new Error(`${entry.bin} could not be invoked: ${(err as Error).message}`)
  }
  const match = SEMVER.exec(output)
  if (!match) throw new Error(`${entry.bin} could not be invoked: no version in ${output.trim()}`)
  return match[0]
}

export interface InstallToolOptions extends GhReleaseOptions {
  exec?: Exec
}

/** Where a driver placed the executable, and what integrity it could prove. */
async function drive(
  dir: string,
  spec: ToolSpec,
  options: InstallToolOptions,
): Promise<{ bin: string; integrity: string }> {
  switch (spec.install.kind) {
    case 'uv-tool':
      return {
        // uv verifies its own downloads against the index; there is nothing for
        // us to re-check.
        integrity: 'n/a',
        bin: await uvInstall(dir, { id: spec.id, ...spec.install }),
      }
    case 'npm-prefix':
      return {
        integrity: 'n/a',
        bin: await npmInstall(dir, { id: spec.id, ...spec.install }, options.exec),
      }
    case 'gh-release':
      return ghReleaseInstall(dir, { id: spec.id, ...spec.install }, options)
  }
}

export async function installTool(
  home: string,
  spec: ToolSpec,
  options: InstallToolOptions = {},
): Promise<ToolLockEntry> {
  const dir = join(toolRoot(home), spec.id)
  const { bin, integrity } = await drive(dir, spec, options)
  const installedAt = new Date().toISOString()

  const resolvedVersion = await verifyTool({ bin }, spec.versionArgv)

  const entry: ToolLockEntry = {
    installKind: spec.install.kind,
    requestedPin: spec.install.pin,
    resolvedVersion,
    bin,
    integrity,
    installedAt,
    verifiedAt: new Date().toISOString(),
  }

  const lock = await loadToolLock(home)
  await saveToolLock(home, { ...lock, tools: { ...lock.tools, [spec.id]: entry } })
  return entry
}

/** M1's entry point, kept so its integration test needs no edit. */
export async function installAndLock(
  home: string,
  spec: UvInstallSpec,
  versionArgv: readonly string[],
): Promise<ToolLockEntry> {
  return installTool(home, {
    id: spec.id,
    displayName: spec.id,
    stage: null,
    runtime: 'uv',
    install: { kind: 'uv-tool', spec: spec.spec, pin: spec.pin, binName: spec.binName },
    versionArgv,
  })
}
