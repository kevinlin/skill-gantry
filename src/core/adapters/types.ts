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

/**
 * R4.14. An argument group the stage executor appends only when a path exists.
 * Declared, never probed: R4.3 forbids an adapter touching the filesystem and
 * lint enforces it, so the manifest names the condition and the executor
 * answers it — after substitution, which is the only point at which the path a
 * tool will actually be handed is known.
 *
 * Appended after `argv`, so a manifest ending in a positional argument cannot
 * use one: the group would land past the positional and read as more
 * positionals. Every shipped manifest ends in an option value.
 */
export interface ConditionalArgv {
  /** Same `{skillDir}`/`{repoRoot}`/`{toolDir}` vocabulary as `argv`. */
  whenExists: string
  argv: readonly string[]
}

/**
 * R4.16. Where a tool keeps the findings its user has accepted, and what one
 * accepted finding looks like inside that file.
 *
 * Declarative rather than a function the adapter exports, for two reasons.
 * R4.1 makes an adapter a manifest and a single `parse`, and a third export
 * would quietly make it three. And R4.3 forbids an adapter touching the
 * filesystem at all, which lint enforces — so the write has to live outside
 * the adapter whatever shape the declaration takes.
 */
export interface BaselineSpec {
  /**
   * `{skillDir}`/`{repoRoot}` vocabulary. Resolved against the **live** skill
   * directory, deliberately unlike `conditionalArgv.whenExists`, which
   * resolves against the tool-facing path: a repo-root skill's tool reads a
   * materialised candidate copy, so a write resolved the tool's way would
   * land in a temp directory and be discarded with it (design §12.5).
   */
  path: string
  document: 'yaml' | 'json'
  /** The sequence one accepted finding is appended to. */
  collection: string
  /** The whole document, written when the file is absent. */
  scaffold: Record<string, unknown>
  /** One entry, in `src/core/suppress/entry.ts`'s finding vocabulary. */
  entry: Readonly<Record<string, string>>
}

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
  invoke: {
    argv: readonly string[]
    cwd: 'skillDir' | 'repoRoot'
    conditionalArgv?: readonly ConditionalArgv[]
  }
  versionArgv: readonly string[]
  artefacts: readonly string[]
  binaryArtefacts?: readonly string[]
  /** R4.16. Absent when the tool has no suppression file of its own. */
  baseline?: BaselineSpec
  timeoutMs: number
}

/**
 * Every alternative this environment satisfies — an alternative being satisfied
 * when all of its required keys are set and non-empty.
 *
 * Exported alongside the boolean because Settings needs the providers by name
 * and the gate needs only the verdict, and the two hand-rolling one predicate
 * is how they came to disagree: the screen tested `.env` alone while the gate
 * tested the composed child environment, so a credential exported by the shell
 * read `missing` on screen and satisfied the run.
 */
export function satisfyingAlternatives(
  req: CredentialRequirement,
  env: Readonly<Record<string, string | undefined>>,
): readonly CredentialSet[] {
  if (req.kind === 'none') return []
  return req.alternatives.filter((alt) => alt.required.every((key) => (env[key] ?? '') !== ''))
}

/** Satisfied by `none`, or by any one alternative whose required keys are all set. */
export function credentialsSatisfied(
  req: CredentialRequirement,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (req.kind === 'none') return true
  return satisfyingAlternatives(req, env).length > 0
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
