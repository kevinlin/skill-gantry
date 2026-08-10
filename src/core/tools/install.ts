import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadToolLock, saveToolLock } from '../config/config.js'
import type { ToolLockEntry } from '../config/schema.js'
import type { ToolSpec } from './catalogue.js'
import { type Exec, defaultExec } from './exec.js'
import { type GhReleaseOptions, ghReleaseInstall } from './gh-release.js'
import { gitSkillInstall } from './git-skill.js'
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

/**
 * What installing needs off a `ToolSpec`, which is less than the catalogue
 * carries: no driver reads `stage`, `serves`, `displayName` or `runtime`.
 * Naming the subset is what lets `installAndLock` build a spec for a tool that
 * is not catalogued at all without inventing a lifecycle stage for it.
 */
export type InstallableTool = Pick<ToolSpec, 'id' | 'install' | 'versionArgv'>

export interface InstallToolOptions extends GhReleaseOptions {
  exec?: Exec
  /** Where `git-skill` looks for runtime skills directories; tests point it at a temp home. */
  userHome?: string
}

/** Where a driver placed the executable, and what integrity it could prove. */
async function drive(
  dir: string,
  spec: InstallableTool,
  options: InstallToolOptions,
): Promise<{ bin: string; integrity: string; links?: string[]; resolvedVersion?: string }> {
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
    case 'git-skill': {
      // git's own object hashing is the integrity check, so there is nothing
      // for us to re-verify — the same reasoning `uv-tool` records.
      const out = await gitSkillInstall(
        dir,
        { id: spec.id, ...spec.install },
        options.exec ?? defaultExec,
        options.userHome ?? homedir(),
      )
      return { integrity: 'n/a', bin: out.bin, links: out.links, resolvedVersion: out.sha }
    }
  }
}

export async function installTool(
  home: string,
  spec: InstallableTool,
  options: InstallToolOptions = {},
): Promise<ToolLockEntry> {
  const dir = join(toolRoot(home), spec.id)
  const { bin, integrity, links, resolvedVersion: driven } = await drive(dir, spec, options)
  const installedAt = new Date().toISOString()

  // A skill bundle has no executable that answers a version argv, so the driver
  // resolves its own identity — the commit sha — and `verifyTool`'s semver
  // regex is bypassed rather than loosened for every other tool.
  const resolvedVersion = driven ?? (await verifyTool({ bin }, spec.versionArgv))

  const entry: ToolLockEntry = {
    installKind: spec.install.kind,
    requestedPin: spec.install.pin,
    resolvedVersion,
    bin,
    integrity,
    ...(links ? { links } : {}),
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
    install: { kind: 'uv-tool', spec: spec.spec, pin: spec.pin, binName: spec.binName },
    versionArgv,
  })
}
