import type {
  PendingMutation,
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
} from '../../src/core/stages/types.js'
import type { RawFinding, Stage, StageOutcome, ToolOutcome } from '../../src/core/types.js'

export interface FakeExecutorOptions {
  /** Stage outcome to report. Defaults to 'passed'. */
  outcome?: StageOutcome
  toolOutcome?: ToolOutcome
  mutating?: boolean
  /** Awaited inside execute(), so a test can hold a stage open. */
  hold?: Promise<void>
  /** Records each call in order. Task 2 adds the mutation calls. */
  calls?: string[]
  /** Returned by prepareMutation. Null means the tools changed nothing. */
  pending?: PendingMutation | null
  /** Reported by the single tool run. Empty unless a test needs R6.10's trigger. */
  findings?: RawFinding[]
}

/**
 * A StageExecutor with no subprocess. The pipeline's sequencing, gating and
 * cancellation are decisions, and a decision is easier to prove against a
 * fake stage than against a shell script pretending to be a scanner.
 */
export function fakeExecutor(stage: Stage, options: FakeExecutorOptions = {}): StageExecutor {
  const calls = options.calls ?? []
  const outcome = options.outcome ?? 'passed'
  const toolOutcome = options.toolOutcome ?? (outcome === 'failed' ? 'failed' : 'passed')

  return {
    stage,
    mutating: options.mutating ?? false,

    async plan(): Promise<StagePlan> {
      return {
        toolIds: ['fake'],
        policy: options.mutating === true ? 'pick-one' : 'fan-out',
        mutationScope: { paths: options.mutating === true ? [`${stage}/SKILL.md`] : [] },
      }
    },

    async execute(ctx: StageContext): Promise<StageResult> {
      calls.push(`execute:${stage}`)
      ctx.onOutput('fake', 'stdout', `${stage} running\n`)
      if (options.hold) await options.hold
      return {
        stage,
        outcome,
        verdict: outcome === 'failed' ? 'failed' : 'passed',
        toolRuns: [
          {
            toolId: 'fake',
            toolVersion: '0.0.0',
            outcome: toolOutcome,
            exitCode: 0,
            durationMs: 1,
            errorKind: null,
            artefactDir: `${ctx.stageDir}/fake`,
            findings: options.findings ?? [],
            metrics: { durationMs: 1 },
            summary: `${stage} fake`,
          },
        ],
      }
    },

    async prepareMutation(): Promise<PendingMutation | null> {
      return options.pending ?? null
    },

    async applyMutation(): Promise<void> {
      calls.push(`apply:${stage}`)
    },

    async discardMutation(): Promise<void> {
      calls.push(`discard:${stage}`)
    },
  }
}
