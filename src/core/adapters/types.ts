import type { KnownRuleClass, Metrics, RawFinding, SkillRef, Stage, ToolOutcome } from '../types.js'

export type Integrity =
  | { kind: 'sha256-asset'; assetPattern: string }
  | { kind: 'sha256-digest'; digest: string }
  | { kind: 'none'; reason: string }

export type InstallSpec =
  | { kind: 'uv-tool'; spec: string; pin: string; binName: string }
  | { kind: 'npm-prefix'; spec: string; pin: string; binName: string }
  | {
      kind: 'gh-release'
      repo: string
      pin: string
      assetPattern: string
      binName: string
      /** Declared, never assumed: M3's driver has no checksum without it. */
      integrity: Integrity
    }

export interface CredentialSet {
  /** Human label for the setup wizard, e.g. 'OpenAI'. */
  provider: string
  /** Every key must be present and non-empty for this alternative to be satisfied. */
  required: readonly string[]
  optional?: readonly string[]
  /** Env assignment selecting this provider, when the tool needs one. */
  selects?: Readonly<Record<string, string>>
}

/**
 * A boolean could not express "one of four provider credential sets", which is
 * what SkillSpector's LLM mode actually needs, so the wizard could neither name
 * the missing value nor tell whether the configured provider was usable.
 */
export type CredentialRequirement =
  | { kind: 'none' }
  | { kind: 'one-of'; alternatives: readonly CredentialSet[] }

export interface AdapterManifest {
  id: string
  stage: Stage
  policy: 'fan-out' | 'pick-one'
  mutating: boolean
  /**
   * Declared reconciliation scope. Widened at runtime by every class this tool
   * has actually produced for the skill, so a too-narrow declaration costs
   * completeness rather than correctness — see Task 17.
   */
  detects: readonly KnownRuleClass[]
  credentials: CredentialRequirement
  /** Recorded in run provenance. A mode change is a new adapter id, never a fallback. */
  analysisMode: string
  install: InstallSpec
  /** `{skillDir}`, `{repoRoot}` and `{toolDir}` are substituted at spawn time. */
  invoke: { argv: readonly string[]; cwd: 'skillDir' | 'repoRoot' }
  versionArgv: readonly string[]
  artefacts: readonly string[]
  binaryArtefacts?: readonly string[]
  timeoutMs: number
}

/** Satisfied by `none`, or by any one alternative whose required keys are all set. */
export function credentialsSatisfied(
  req: CredentialRequirement,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (req.kind === 'none') return true
  return req.alternatives.some((alt) => alt.required.every((key) => (env[key] ?? '') !== ''))
}

/** Names what is missing, for the wizard and for the skip summary. */
export function missingCredentials(req: CredentialRequirement): string {
  if (req.kind === 'none') return ''
  return req.alternatives.map((a) => `${a.provider} (${a.required.join(', ')})`).join(' or ')
}

/** Pure input: the runner has already read the files. */
export interface ParseContext {
  skill: SkillRef
  artefacts: ReadonlyMap<string, Buffer>
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

export interface ToolResult {
  outcome: Extract<ToolOutcome, 'passed' | 'failed' | 'errored'>
  findings: RawFinding[]
  metrics: Metrics
  summary: string
}

export type Parse = (ctx: ParseContext) => ToolResult

export interface Adapter {
  manifest: AdapterManifest
  parse: Parse
}
