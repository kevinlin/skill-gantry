import type { StageResult, ToolRunRecord } from '../stages/types.js'
import type { Stage, StageOutcome } from '../types.js'
import type { CancelPhase } from './cancellation.js'

export type RunEvent =
  | { type: 'run:start'; runId: string; skillId: string; stages: readonly Stage[]; runDir: string }
  | { type: 'stage:start'; runId: string; stage: Stage; toolIds: readonly string[] }
  | { type: 'tool:start'; runId: string; stage: Stage; toolId: string }
  | {
      type: 'tool:output'
      runId: string
      stage: Stage
      toolId: string
      stream: 'stdout' | 'stderr'
      chunk: string
    }
  | { type: 'tool:done'; runId: string; stage: Stage; toolId: string; result: ToolRunRecord }
  | { type: 'stage:done'; runId: string; stage: Stage; outcome: StageOutcome; result: StageResult }
  | {
      type: 'mutation:pending'
      runId: string
      stage: Stage
      requestId: string
      diff: string
      scope: readonly string[]
    }
  | {
      type: 'mutation:resolved'
      runId: string
      stage: Stage
      requestId: string
      action: 'apply' | 'discard'
    }
  | {
      type: 'run:done'
      runId: string
      outcome: StageOutcome
      opened: number
      closed: number
      reopened: number
    }
  | { type: 'run:cancelled'; runId: string; phase: CancelPhase; reason: string }
  | { type: 'run:error'; runId: string; message: string }
