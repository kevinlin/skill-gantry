import type { ToolLock } from '../config/schema.js'
import type {
  ErrorKind,
  Metrics,
  RawFinding,
  SkillRef,
  Stage,
  StageOutcome,
  ToolOutcome,
} from '../types.js'

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
  selectedToolIds: readonly string[]
  lock: ToolLock
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  artefactSizeCapBytes: number
  timeoutOverridesMs: Readonly<Record<string, number>>
  onOutput: (toolId: string, stream: 'stdout' | 'stderr', chunk: string) => void
  signal?: AbortSignal
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

export interface StageExecutor {
  readonly stage: Stage
  readonly mutating: boolean
  plan(ctx: StageContext): Promise<StagePlan>
  execute(ctx: StageContext, plan: StagePlan): Promise<StageResult>
}
