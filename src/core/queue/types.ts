import type { RunEvent } from '../pipeline/events.js'
import type { SkillRef, Stage, StageOutcome } from '../types.js'

export interface JobSpec {
  skill: SkillRef
  stages: readonly Stage[]
  trigger?: string
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface JobRecord {
  jobId: string
  skillId: string
  stages: readonly Stage[]
  state: JobState
  runId: string | null
  outcome: StageOutcome | null
  error: string | null
  enqueuedAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface QueueSnapshot {
  concurrency: number
  queued: JobRecord[]
  running: JobRecord[]
  completed: JobRecord[]
}

export type QueueEvent =
  | { type: 'job:queued'; job: JobRecord }
  | { type: 'job:started'; job: JobRecord }
  | { type: 'job:done'; job: JobRecord }
  | { type: 'job:failed'; job: JobRecord }
  | { type: 'job:cancelled'; job: JobRecord }
  /** Every run event, tagged so one stream can drive one store. */
  | { type: 'run:event'; jobId: string; event: RunEvent }

export interface QueueHandle {
  enqueue(specs: readonly JobSpec[]): string[]
  snapshot(): QueueSnapshot
  cancelJob(jobId: string): Promise<void>
  /**
   * R5.12's command path, routed by job rather than by run: a frontend knows
   * which job it is looking at, and the run id only appears on the event stream.
   */
  resolveMutation(jobId: string, requestId: string, action: 'apply' | 'discard'): void
  events: AsyncIterable<QueueEvent>
  /** Resolves when nothing is queued and nothing is running. */
  idle(): Promise<void>
  close(): void
}

/** R5.7's set. Kept here so the queue never imports a stage executor. */
export const MUTATING_STAGES: ReadonlySet<Stage> = new Set<Stage>(['optimise', 'release'])

export const isMutatingJob = (stages: readonly Stage[]): boolean =>
  stages.some((stage) => MUTATING_STAGES.has(stage))
