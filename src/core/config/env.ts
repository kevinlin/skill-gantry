import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const MODEL_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
] as const

const SECRET_KEY = /(_TOKEN|_KEY|_SECRET|_PASSWORD)$/

export interface EnvLoad {
  present: boolean
  vars: Record<string, string>
  /** Distinct literal values to scrub from anything written to disk. */
  secrets: string[]
  warnings: string[]
}

export interface Provenance {
  baseUrlHost: string | null
  models: Record<string, string | null>
  authTokenHash: string | null
  /**
   * `toolId -> manifest.analysisMode`, filled by the pipeline from the tools it
   * actually selected. A tool that changes analysis mode changes what its
   * numbers mean, so the mode belongs beside the provider fingerprint that
   * already exists for the same reason (R4.2b).
   */
  analysisModes: Record<string, string>
}

function parse(source: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (value.length > 1 && /^(".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    vars[key] = value
  }
  return vars
}

export async function loadEnvFile(home: string): Promise<EnvLoad> {
  const file = join(home, '.env')
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { present: false, vars: {}, secrets: [], warnings: [] }
    }
    throw err
  }

  const warnings: string[] = []
  const info = await stat(file)
  if ((info.mode & 0o077) !== 0) {
    warnings.push(`${file} is more permissive than 600 (mode ${(info.mode & 0o777).toString(8)})`)
  }

  const vars = parse(source)
  const secrets = [
    ...new Set(
      Object.entries(vars)
        .filter(([key, value]) => SECRET_KEY.test(key) && value.length >= 8)
        .map(([, value]) => value),
    ),
  ]
  return { present: true, vars, secrets, warnings }
}

/**
 * The child environment for every spawned tool: the ambient environment, then
 * `.env`, then one derived key (R7.3).
 *
 * A gateway credential is the pair `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`,
 * and a tool that probes `ANTHROPIC_API_KEY` alone reads that as no credential
 * at all — skill-up logs `ANTHROPIC_API_KEY not set, claude-code will rely on
 * existing login state if available` against a fully configured gateway, once
 * per case. §5.4's `profileEnv` already emits both forms into the file it
 * composes for the same reason; the spawn is where R7.3 says the injection
 * actually happens, so it derives the same pair.
 *
 * Guarded twice, each guard against a way of making auth worse. An explicit
 * `ANTHROPIC_API_KEY` is never overwritten. And nothing is derived without a
 * base URL, nor against `api.anthropic.com`, where a bearer token and an
 * `x-api-key` are different credentials and sending one as the other turns
 * working auth into a 401. An unparsable base URL is a gateway: the direct
 * endpoint is the case being excluded, and it is spelled exactly.
 */
export function spawnEnv(
  ambient: NodeJS.ProcessEnv,
  vars: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...ambient, ...vars }
  const token = env.ANTHROPIC_AUTH_TOKEN
  const base = env.ANTHROPIC_BASE_URL
  if (token && base && !env.ANTHROPIC_API_KEY && !isAnthropicDirect(base)) {
    env.ANTHROPIC_API_KEY = token
  }
  return env
}

function isAnthropicDirect(base: string): boolean {
  try {
    return new URL(base).host === 'api.anthropic.com'
  } catch {
    return false
  }
}

export function provenanceOf(vars: Record<string, string>): Provenance {
  const base = vars.ANTHROPIC_BASE_URL ?? vars.OPENAI_BASE_URL
  let host: string | null = null
  if (base) {
    try {
      host = new URL(base).host
    } catch {
      host = null
    }
  }

  const models: Record<string, string | null> = {}
  for (const key of MODEL_KEYS) models[key] = vars[key] ?? null

  const token = vars.ANTHROPIC_AUTH_TOKEN ?? vars.OPENAI_API_KEY ?? vars.ANTHROPIC_API_KEY
  const authTokenHash = token
    ? `sha256:${createHash('sha256').update(token).digest('hex').slice(0, 8)}`
    : null

  return { baseUrlHost: host, models, authTokenHash, analysisModes: {} }
}

/** Called by the pipeline once tool selection is known. */
export function withAnalysisModes(
  provenance: Provenance,
  modes: Record<string, string>,
): Provenance {
  return { ...provenance, analysisModes: { ...provenance.analysisModes, ...modes } }
}
