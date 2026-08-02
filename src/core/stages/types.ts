import type { ToolLock } from '../config/schema.js'
import type { MutationSandbox } from '../isolation/types.js'
import type {
  ErrorKind,
  Metrics,
  RawFinding,
  SkillRef,
  Stage,
  StageOutcome,
  ToolOutcome,
} from '../types.js'

/** R9.10: supplied explicitly, never inferred. */
export interface ReleaseTarget {
  /** A semver, or one of `major` / `minor` / `patch`. */
  version: string
  /** Free text prepended under the new changelog heading. */
  notes?: string
}

export interface MutationScope {
  /** Repo-relative paths this stage may write. May include repo-root files. */
  paths: readonly string[]
}

export interface StagePlan {
  toolIds: readonly string[]
  policy: 'fan-out' | 'pick-one' | 'native'
  mutationScope: MutationScope
}

export interface StageContext {
  skill: SkillRef
  stage: Stage
  /** Absolute path to `<run>/NN-<stage>/`. */
  stageDir: string
  /** `<workspace>/skillgantry/runs/<runId>` — where sandbox.json and the journal live. */
  runDir: string
  selectedToolIds: readonly string[]
  lock: ToolLock
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  artefactSizeCapBytes: number
  timeoutOverridesMs: Readonly<Record<string, number>>
  onOutput: (toolId: string, stream: 'stdout' | 'stderr', chunk: string) => void
  signal?: AbortSignal
  /**
   * R5.2. For a mutating stage: true means the write may proceed once the diff
   * has been shown. In the TUI it is always true and the gate prompts; headless
   * it is `--yes`. False makes the stage `skipped` with `no-authorisation`.
   */
  authorised: boolean
  /** Present only for a mutating stage, opened by the pipeline before any tool. */
  sandbox?: MutationSandbox
  releaseTarget?: ReleaseTarget
  /** R10.3's override, off by default. */
  allowDirty?: boolean
}

export interface ToolRunRecord {
  toolId: string
  toolVersion: string | null
  outcome: ToolOutcome
  exitCode: number | null
  durationMs: number
  errorKind: ErrorKind | null
  artefactDir: string
  findings: RawFinding[]
  metrics: Metrics
  summary: string
}

export interface StageResult {
  stage: Stage
  outcome: StageOutcome
  verdict: 'passed' | 'failed'
  toolRuns: ToolRunRecord[]
}

export interface PendingMutation {
  /** Unified diff for preview. Empty when the change set is binary-only. */
  diff: string
  /** Repo-relative paths this mutation would write. */
  scope: readonly string[]
}

export interface StageExecutor {
  readonly stage: Stage
  readonly mutating: boolean
  plan(ctx: StageContext): Promise<StagePlan>
  execute(ctx: StageContext, plan: StagePlan): Promise<StageResult>
  /** Mutating executors only. Null means the tools changed nothing. */
  prepareMutation?(
    ctx: StageContext,
    plan: StagePlan,
    result: StageResult,
  ): Promise<PendingMutation | null>
  applyMutation?(ctx: StageContext, pending: PendingMutation): Promise<void>
  discardMutation?(ctx: StageContext, pending: PendingMutation): Promise<void>
}
