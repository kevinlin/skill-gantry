import { createHash } from 'node:crypto'
import { mkdir, open, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * SkillHone reads its whole model configuration from one file, and three of its
 * entry points refuse to start without it: `optim.py`, `new.py` and `synth.py`
 * each print `~/.skillhone/settings.json not found` and exit 1 before they read
 * a single environment variable. Every value that file needs is already in
 * `~/.skillgantry/.env`, so R3.10 has setup compose it rather than leaving a
 * verified install that cannot run.
 *
 * Everything below is pinned to the catalogued checkout (`7d56583`). Where a
 * rule looks arbitrary it is upstream's, and the comment names the line.
 */

/** `optim.py`, `new.py`, `synth.py` and `evaluation/template.py` all hardcode
 * `Path.home()`; only `status.py` and `seed.py` honour `SKILLHONE_HOME`, so
 * relocating the file would hide it from the three that need it most. */
const SETTINGS_DIR = '.skillhone'
const SETTINGS_FILE = 'settings.json'

const DIR_MODE = 0o700
const FILE_MODE = 0o600

/**
 * `template.py` reads `executor.workers` with an upstream default of 16. Sixteen
 * concurrent agent sessions against one gateway is not a default to inherit
 * silently, so the composed file states a smaller number rather than omitting
 * the key and letting upstream's stand.
 */
const EXECUTOR_WORKERS = 4

export interface SkillhoneProfile {
  api_key: string
  api_base: string
  model: string
  sdk_model_alias: string
  workers?: number
  env?: Record<string, string>
}

export interface SkillhoneSettings {
  api_key: string
  improver: SkillhoneProfile
  executor: SkillhoneProfile
  synthesis: SkillhoneProfile
}

export type ConfigureOutcome =
  /** Composed and renamed into place; `sha256` is over the exact bytes written. */
  | { kind: 'written'; path: string; sha256: string }
  /** Present already, and not ours to replace — R3.10. */
  | { kind: 'exists'; path: string }
  /** `.env` holds no token, no base URL, or no model to point a role at. */
  | { kind: 'no-credentials' }
  /** The tool declares no configuration file. */
  | { kind: 'skipped' }

/**
 * The three roles SkillHone resolves, each with the alias it must carry.
 * `template.py` defaults a missing `sdk_model_alias` to `haiku` while
 * `litellm_proxy.py` defaults the same profile to `opus`, so a profile without
 * one tells the SDK to use a model whose `ANTHROPIC_DEFAULT_*` key was never
 * set. Every role therefore states its alias explicitly.
 */
const ROLES = [
  { name: 'improver', alias: 'opus', modelKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  { name: 'executor', alias: 'haiku', modelKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
  { name: 'synthesis', alias: 'sonnet', modelKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
] as const

type RoleName = (typeof ROLES)[number]['name']

export function skillhoneSettingsPath(userHome: string): string {
  return join(userHome, SETTINGS_DIR, SETTINGS_FILE)
}

/** Strict JSON, no comments: only `status.py` reaches for json5, and every
 * other reader is stdlib `json.loads`, which rejects the commented template
 * upstream ships as `assets/settings.json`. */
export function serialiseSkillhoneSettings(settings: SkillhoneSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`
}

export function settingsDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * A `/` in the model name switches SkillHone onto its LiteLLM loopback proxy
 * (`litellm_proxy.py`'s `use_litellm`), and on that branch the proxy's own
 * environment is the right operand of the merge, so the profile's `env` block
 * is discarded wholesale. Emitting one there would look like configuration and
 * be inert. On the slashless branch `env` wins over the derived values, which
 * is the only way `ANTHROPIC_AUTH_TOKEN` reaches the agent at all — the direct
 * branch derives `ANTHROPIC_API_KEY` and nothing else, and a token gateway
 * needs the bearer form.
 */
function profileEnv(
  token: string,
  base: string,
  alias: string,
  models: Record<string, string>,
): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: token,
    ANTHROPIC_MODEL: alias,
    ...models,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
  }
}

/**
 * Null when `~/.skillgantry/.env` cannot produce a usable configuration, so the
 * caller reports a missing credential rather than writing a file that
 * authenticates against nothing.
 */
export function skillhoneSettings(vars: Record<string, string>): SkillhoneSettings | null {
  const token = vars.ANTHROPIC_AUTH_TOKEN ?? vars.ANTHROPIC_API_KEY
  const base = vars.ANTHROPIC_BASE_URL
  if (!token || !base) return null

  const fallbackModel = vars.ANTHROPIC_MODEL
  const resolved: { name: RoleName; alias: string; modelKey: string; model: string }[] = []
  for (const role of ROLES) {
    const model = vars[role.modelKey] ?? fallbackModel
    if (!model) return null
    resolved.push({ ...role, model })
  }

  // Every `ANTHROPIC_DEFAULT_*` key that resolves, on every profile: the SDK
  // picks the one its alias names, and a profile carrying only its own would
  // break the moment a role fell back to another's alias.
  const models: Record<string, string> = {}
  for (const role of resolved) models[role.modelKey] = role.model

  const profiles = {} as Record<RoleName, SkillhoneProfile>
  for (const role of resolved) {
    profiles[role.name] = {
      api_key: token,
      api_base: base,
      model: role.model,
      sdk_model_alias: role.alias,
      ...(role.name === 'executor' ? { workers: EXECUTOR_WORKERS } : {}),
      ...(role.model.includes('/')
        ? {}
        : { env: profileEnv(token, base, role.alias, models) }),
    }
  }

  // The top-level key is read only by `template.py`'s `_get_api_key`, which
  // ignores every per-profile key — the fallback solver and the legacy branch
  // authenticate with this one or not at all.
  return { api_key: token, ...profiles }
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/**
 * R3.10: never replace a file SkillGantry did not write. The file holds the
 * user's API key and may have been hand-tuned against a gateway this builder
 * knows nothing about, so an existing one is reported and left. `doctor` names
 * it, which is how a user adopts the managed file deliberately.
 *
 * One temp file and one rename, the discipline §12.5 gives the suppress writer.
 * No sandbox, no journal and no marker, for §12.5's reasons: one file, one
 * rename, and no tool driving the tree while it happens.
 */
export async function writeSkillhoneSettings(
  userHome: string,
  settings: SkillhoneSettings,
): Promise<ConfigureOutcome> {
  const dir = join(userHome, SETTINGS_DIR)
  const path = join(dir, SETTINGS_FILE)
  await mkdir(dir, { recursive: true, mode: DIR_MODE })
  if (await exists(path)) return { kind: 'exists', path }

  const text = serialiseSkillhoneSettings(settings)
  const temp = `${path}.tmp`
  const handle = await open(temp, 'w', FILE_MODE)
  try {
    // Explicit, because the open mode is masked by the user's umask and a
    // reused temp file from a crashed write keeps whatever mode it had.
    await handle.chmod(FILE_MODE)
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temp, path)
  return { kind: 'written', path, sha256: settingsDigest(text) }
}
