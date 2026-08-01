import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { isGitRepo } from '../discovery/discover.js'
import { type GantryConfig, type ToolLock, configSchema, toolLockSchema } from './schema.js'

export type { GantryConfig, ToolLock, ToolLockEntry } from './schema.js'

export const DEFAULT_CONFIG: GantryConfig = {
  version: 1,
  repos: [],
  stageTools: { validate: [], evaluate: [], security: ['skillspector'], optimise: [] },
  concurrency: 2,
  artefactSizeCapBytes: 32 * 1024 * 1024,
  timeoutOverridesMs: {},
}

const configFile = (home: string): string => join(home, 'config.json')
const lockFile = (home: string): string => join(home, 'tools', 'lock.json')

/** Expand, resolve symlinks, strip a trailing separator. */
export async function canonicalisePath(input: string): Promise<string> {
  const absolute = resolve(input)
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

export async function registerRepo(home: string, repoPath: string): Promise<GantryConfig> {
  const path = await canonicalisePath(repoPath)
  const config = await loadConfig(home)
  if (config.repos.some((r) => r.path === path)) {
    throw new Error(`already registered: ${path}`)
  }
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
