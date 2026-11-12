import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli/main.js'
import type { CliDeps } from '../../src/cli/run-command.js'
import {
  DEFAULT_CONFIG,
  loadConfig,
  registerRepo,
  saveConfig,
  saveToolLock,
} from '../../src/core/config/config.js'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'
import { fakeSkillsBin, skillsLockEntry } from './release-fixture.js'
import { SKILL_MD_FULL, makeGitRepo, makeRepo } from './tmp-repo.js'

export interface Headless {
  home: string
  dbPath: string
  /** One path per registered repo, in registration order. */
  repos: string[]
  out: string[]
  err: string[]
  deps: CliDeps
  /** `main()` over this home, the way the bin entry calls it. */
  run(args: readonly string[], over?: Partial<CliDeps>): Promise<number>
  /** Every discovered skill in every registered repo. */
  skills(): Promise<SkillRef[]>
  /** The stdout stream parsed as the one document it must be. */
  json<T = unknown>(): T
}

export interface HeadlessSpec {
  /** One file map per repo to register. Default: one repo holding `sk`. */
  repos?: ReadonlyArray<Record<string, string>>
  git?: boolean
  /** Lock a stand-in vercel `skills`, the one tool a release needs. */
  releaseTool?: boolean
}

/**
 * A home, registered repos and a `CliDeps` that captures both streams, driven
 * through `main()` — the entry the bin calls, which is the surface an agent
 * sees. Nothing here opens a terminal or reaches the network.
 */
export async function makeHeadless(spec: HeadlessSpec = {}): Promise<Headless> {
  const home = await mkdtemp(join(tmpdir(), 'sg-headless-'))
  await saveConfig(home, DEFAULT_CONFIG)

  const specs = spec.repos ?? [{ 'sk/SKILL.md': SKILL_MD_FULL('sk') }]
  const repos: string[] = []
  for (const files of specs) {
    const path = await (spec.git === true ? makeGitRepo({ files }) : makeRepo({ files }))
    await registerRepo(home, path)
    repos.push(path)
  }
  if (spec.releaseTool === true) {
    await saveToolLock(home, {
      version: 1,
      tools: { skills: skillsLockEntry(await fakeSkillsBin()) },
    })
  }

  const out: string[] = []
  const err: string[] = []
  const deps: CliDeps = {
    home,
    dbPath: join(home, 'gantry.db'),
    write: (line) => out.push(line),
    writeErr: (line) => err.push(line),
    // The launch check reaches the release index; the default suite is offline.
    maybeUpgrade: async () => 'continue',
  }

  return {
    home,
    dbPath: deps.dbPath,
    repos,
    out,
    err,
    deps,
    run: (args, over = {}) => main(['node', 'skillgantry', ...args], { ...deps, ...over }),
    skills: async () => {
      const config = await loadConfig(home)
      const found: SkillRef[] = []
      for (const repo of config.repos) found.push(...(await discoverSkills(repo)))
      return found
    },
    json: <T>() => JSON.parse(out.join('\n')) as T,
  }
}
