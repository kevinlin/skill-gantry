import { basename } from 'node:path'
import { stageToolsFor } from '../tools/setup.js'
import { type GantryConfig, configSchema } from './schema.js'

/**
 * The decisions over a config document, kept out of the module that owns the
 * file. `registerRepo` and the TUI's staged edit both route through these, so
 * the two cannot disagree about what a valid change is — which is exactly what
 * a second write path would have produced.
 */

function uniqueId(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired
  for (let n = 2; ; n += 1) {
    const candidate = `${desired}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export function withRepo(
  config: GantryConfig,
  entry: { path: string; isGit: boolean },
): GantryConfig {
  if (config.repos.some((repo) => repo.path === entry.path)) {
    throw new Error(`already registered: ${entry.path}`)
  }
  const name = basename(entry.path)
  return {
    ...config,
    repos: [
      ...config.repos,
      {
        id: uniqueId(name, new Set(config.repos.map((repo) => repo.id))),
        path: entry.path,
        name,
        isGit: entry.isGit,
      },
    ],
  }
}

export function withoutRepo(config: GantryConfig, repoId: string): GantryConfig {
  return { ...config, repos: config.repos.filter((repo) => repo.id !== repoId) }
}

export function withStageTools(
  config: GantryConfig,
  selected: readonly string[],
  isRunnable: (toolId: string) => boolean,
): GantryConfig {
  return { ...config, stageTools: stageToolsFor(selected, isRunnable) }
}

const OVERRIDE_PREFIX = 'timeoutOverridesMs.'

export type ScalarField =
  | 'concurrency'
  | 'artefactSizeCapBytes'
  | 'mutationTimeoutMs'
  | `${typeof OVERRIDE_PREFIX}${string}`

/**
 * `raw` is what the user typed, so both halves of the rejection matter: the
 * parse names the text back, and the schema names the bound it broke. Staging a
 * value the schema would reject on apply is how an editor turns a typo into a
 * config file that no longer loads.
 */
export function withScalar(config: GantryConfig, field: ScalarField, raw: string): GantryConfig {
  const trimmed = raw.trim()
  const next = { ...config }

  if (field.startsWith(OVERRIDE_PREFIX)) {
    const toolId = field.slice(OVERRIDE_PREFIX.length)
    const overrides = { ...config.timeoutOverridesMs }
    if (trimmed.length === 0) delete overrides[toolId]
    else overrides[toolId] = wholeNumber(trimmed)
    next.timeoutOverridesMs = overrides
  } else {
    // A switch rather than `next[field] = …`: writing through a union-typed key
    // is rejected under `strict`, because TypeScript cannot prove the value fits
    // every member of the union.
    const value = wholeNumber(trimmed)
    switch (field) {
      case 'concurrency':
        next.concurrency = value
        break
      case 'artefactSizeCapBytes':
        next.artefactSizeCapBytes = value
        break
      case 'mutationTimeoutMs':
        next.mutationTimeoutMs = value
        break
    }
  }

  return configSchema.parse(next)
}

function wholeNumber(raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`not a whole number: ${raw}`)
  return value
}

export interface ConfigChange {
  kind: 'add' | 'remove' | 'change'
  /** Dotted field path: `concurrency`, `stageTools.validate`, `repos[zapac]`. */
  path: string
  before: string | null
  after: string | null
}

const SCALARS = ['concurrency', 'artefactSizeCapBytes', 'mutationTimeoutMs'] as const

/**
 * Field-level rather than textual. A line diff over the serialised document
 * reports an array edit as a block move, which is not the change the user made,
 * and `unifiedDiffFor` spawns — which `src/tui/**` may not.
 *
 * Emitted in document order: repos, stage tools, scalars, overrides. A stable
 * order is what lets the confirmation pane be asserted at all.
 */
export function configChanges(current: GantryConfig, staged: GantryConfig): ConfigChange[] {
  const out: ConfigChange[] = []

  const currentRepos = new Map(current.repos.map((repo) => [repo.id, repo]))
  const stagedRepos = new Map(staged.repos.map((repo) => [repo.id, repo]))
  for (const [id, repo] of stagedRepos) {
    if (!currentRepos.has(id)) {
      out.push({ kind: 'add', path: `repos[${id}]`, before: null, after: repo.path })
    }
  }
  for (const [id, repo] of currentRepos) {
    if (!stagedRepos.has(id)) {
      out.push({ kind: 'remove', path: `repos[${id}]`, before: repo.path, after: null })
    }
  }

  for (const stage of Object.keys(staged.stageTools) as Array<keyof GantryConfig['stageTools']>) {
    const before = current.stageTools[stage].join(', ')
    const after = staged.stageTools[stage].join(', ')
    if (before === after) continue
    out.push({
      kind: 'change',
      path: `stageTools.${stage}`,
      before: before.length === 0 ? '(none)' : before,
      after: after.length === 0 ? '(none)' : after,
    })
  }

  for (const field of SCALARS) {
    if (current[field] === staged[field]) continue
    out.push({
      kind: 'change',
      path: field,
      before: String(current[field]),
      after: String(staged[field]),
    })
  }

  const toolIds = new Set([
    ...Object.keys(current.timeoutOverridesMs),
    ...Object.keys(staged.timeoutOverridesMs),
  ])
  for (const toolId of [...toolIds].sort()) {
    const before = current.timeoutOverridesMs[toolId]
    const after = staged.timeoutOverridesMs[toolId]
    if (before === after) continue
    out.push({
      kind: before === undefined ? 'add' : after === undefined ? 'remove' : 'change',
      path: `timeoutOverridesMs.${toolId}`,
      before: before === undefined ? null : String(before),
      after: after === undefined ? null : String(after),
    })
  }

  return out
}
