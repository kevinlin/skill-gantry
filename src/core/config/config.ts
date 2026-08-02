import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { countSkills, isGitRepo } from '../discovery/discover.js'
import { type GantryConfig, type ToolLock, configSchema, toolLockSchema } from './schema.js'

export type { GantryConfig, ToolLock, ToolLockEntry } from './schema.js'

export const DEFAULT_CONFIG: GantryConfig = {
  version: 1,
  repos: [],
  stageTools: { validate: [], evaluate: [], security: ['skillspector'], optimise: [] },
  concurrency: 2,
  artefactSizeCapBytes: 32 * 1024 * 1024,
  timeoutOverridesMs: {},
  mutationTimeoutMs: 300_000,
}

const configFile = (home: string): string => join(home, 'config.json')
const lockFile = (home: string): string => join(home, 'tools', 'lock.json')

/**
 * `resolve()` treats `~` as an ordinary path segment, so a user who types the
 * shorthand their shell expands would have registered `<cwd>/~/dev/skills` and
 * seen a repo with no skills in it rather than an error.
 */
function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith(`~${sep}`)) {
    return join(homedir(), input.slice(2))
  }
  return input
}

/** Expand `~`, resolve symlinks, strip a trailing separator. */
export async function canonicalisePath(input: string): Promise<string> {
  const absolute = resolve(expandHome(input.trim()))
  let real: string
  try {
    real = await realpath(absolute)
  } catch {
    real = absolute
  }
  return real.length > 1 && real.endsWith(sep) ? real.slice(0, -1) : real
}

export async function loadConfig(home: string): Promise<GantryConfig> {
  try {
    return configSchema.parse(JSON.parse(await readFile(configFile(home), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG
    throw err
  }
}

export async function saveConfig(home: string, config: GantryConfig): Promise<void> {
  const validated = configSchema.parse(config)
  await mkdir(home, { recursive: true })
  await writeFile(configFile(home), `${JSON.stringify(validated, null, 2)}\n`)
}

function uniqueId(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired
  for (let n = 2; ; n += 1) {
    const candidate = `${desired}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** What the caller needs to decide whether a typed path is worth registering. */
export interface RepoInspection {
  /** Where the input actually points once `~` and symlinks are resolved. */
  resolved: string
  isDirectory: boolean
  alreadyRegistered: boolean
  /** Direct children holding a `SKILL.md`, or 1 for a repo-root skill. */
  skillCount: number
}

/**
 * Read-only counterpart to `registerRepo`, so a caller can show the user what a
 * path resolves to before committing it. An empty repo is reported rather than
 * refused: registering one before authoring its first skill is legitimate.
 */
export async function inspectRepo(home: string, repoPath: string): Promise<RepoInspection> {
  const resolved = await canonicalisePath(repoPath)
  const [config, info] = await Promise.all([loadConfig(home), stat(resolved).catch(() => null)])
  const alreadyRegistered = config.repos.some((r) => r.path === resolved)

  const isDirectory = info?.isDirectory() === true
  if (!isDirectory) return { resolved, isDirectory, alreadyRegistered, skillCount: 0 }
  return { resolved, isDirectory, alreadyRegistered, skillCount: await countSkills(resolved) }
}

export async function registerRepo(home: string, repoPath: string): Promise<GantryConfig> {
  // The same read the wizard's preview uses, so the verdict it showed and the
  // rule that accepts the path cannot drift apart.
  const { resolved: path, isDirectory, alreadyRegistered } = await inspectRepo(home, repoPath)
  if (alreadyRegistered) throw new Error(`already registered: ${path}`)
  // Discovery over a missing path throws deep in readdir; refusing here names
  // the path the user actually typed instead.
  if (!isDirectory) throw new Error(`no such directory: ${path}`)

  const config = await loadConfig(home)
  const name = basename(path)
  const next: GantryConfig = {
    ...config,
    repos: [
      ...config.repos,
      {
        id: uniqueId(name, new Set(config.repos.map((r) => r.id))),
        path,
        name,
        isGit: await isGitRepo(path),
      },
    ],
  }
  await saveConfig(home, next)
  return next
}

export async function loadToolLock(home: string): Promise<ToolLock> {
  try {
    return toolLockSchema.parse(JSON.parse(await readFile(lockFile(home), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tools: {} }
    throw err
  }
}

export async function saveToolLock(home: string, lock: ToolLock): Promise<void> {
  const validated = toolLockSchema.parse(lock)
  await mkdir(join(home, 'tools'), { recursive: true })
  await writeFile(lockFile(home), `${JSON.stringify(validated, null, 2)}\n`)
}
