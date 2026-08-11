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

/**
 * Stages the engine plans without a configured tool. `run.ts` selects
 * `ReleaseStageExecutor` off this and nothing else, so a frontend asking
 * "can this stage run?" asks the same question the executor factory answers —
 * a second copy of the literal in `src/tui/**` is a mark that lands on a stage
 * whose `plan()` then throws R4.11 from inside a run that should not have
 * started.
 */
export const isNativeStage = (stage: Stage): boolean => stage === 'release'

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
  /** `<workspace>/skillgantry/runs/<startTime>` — where sandbox.json and the journal live. */
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
  /**
   * All three are stamped by the pipeline after the stage settles, in one
   * place, so an aborted stage (§8.1 rows 3b and 3c) carries them too rather
   * than each executor remembering to. Absent means "not recorded" and reaches
   * the ledger as null: a stage span defaulted to the run's is the lie
   * migration 3 exists to delete.
   */
  metrics?: Metrics
  startedAt?: string
  endedAt?: string
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
