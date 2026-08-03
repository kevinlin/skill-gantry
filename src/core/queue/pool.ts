import { randomUUID } from 'node:crypto'
import type { RunHandle } from '../pipeline/run.js'
import { AsyncEventQueue } from '../pipeline/queue.js'
import {
  type JobRecord,
  type JobSpec,
  type QueueEvent,
  type QueueHandle,
  type QueueSnapshot,
  isMutatingJob,
} from './types.js'

export interface QueueOptions {
  concurrency: number
  /** Injected so the queue schedules and the caller wires. */
  startRun: (job: JobRecord, spec: JobSpec) => RunHandle
}

interface Entry {
  job: JobRecord
  spec: JobSpec
}

const nowIso = (): string => new Date().toISOString()

export function createQueue(options: QueueOptions): QueueHandle {
  const concurrency = Math.max(1, options.concurrency)
  const events = new AsyncEventQueue<QueueEvent>()
  const queued: Entry[] = []
  const running = new Map<string, Entry & { handle: RunHandle; settled: Promise<void> }>()
  const completed: JobRecord[] = []
  let idleWaiters: Array<() => void> = []
  let closed = false

  const mutatingRunning = (): boolean =>
    [...running.values()].some((entry) => isMutatingJob(entry.job.stages))

  const settleIdle = (): void => {
    if (queued.length > 0 || running.size > 0) return
    const waiters = idleWaiters
    idleWaiters = []
    // Deferred by a macrotask so every event pushed on the way to idle has
    // reached its consumer: an observer that awaits idle() and then reads the
    // stream would otherwise race the delivery of the last job's own event.
    setTimeout(() => {
      for (const waiter of waiters) waiter()
    }, 0)
  }

  const finish = (job: JobRecord): void => {
    job.endedAt = nowIso()
    running.delete(job.jobId)
    completed.push(job)
    const type =
      job.state === 'cancelled'
        ? 'job:cancelled'
        : job.state === 'failed'
          ? 'job:failed'
          : 'job:done'
    events.push({ type, job: { ...job } } as QueueEvent)
    pump()
  }

  /**
   * One job's failure is contained here: nothing rethrows, so the pool keeps
   * draining whatever else was enqueued. That is R5.8.
   */
  const drive = async (job: JobRecord, handle: RunHandle): Promise<void> => {
    const forwarding = (async () => {
      for await (const event of handle.events) {
        events.push({ type: 'run:event', jobId: job.jobId, event })
      }
    })()

    try {
      const summary = await handle.done
      job.runId = summary.runId
      job.outcome = summary.outcome
      if (job.state !== 'cancelled') job.state = 'done'
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err)
      if (job.state !== 'cancelled') job.state = 'failed'
    }

    await forwarding.catch(() => undefined)
    finish(job)
  }

  const start = (entry: Entry): void => {
    entry.job.state = 'running'
    entry.job.startedAt = nowIso()
    const handle = options.startRun(entry.job, entry.spec)
    const record = { ...entry, handle, settled: Promise.resolve() }
    record.settled = drive(entry.job, handle)
    running.set(entry.job.jobId, record)
    events.push({ type: 'job:started', job: { ...entry.job } })
  }

  function pump(): void {
    while (!closed && running.size < concurrency) {
      // A mutating job waits for the single mutation slot; anything read-only
      // behind it still starts, so one paused prompt cannot stall the board.
      const index = queued.findIndex(
        (entry) => !isMutatingJob(entry.job.stages) || !mutatingRunning(),
      )
      if (index === -1) break
      const [entry] = queued.splice(index, 1)
      start(entry as Entry)
    }
    settleIdle()
  }

  return {
    enqueue(specs) {
      const ids: string[] = []
      for (const spec of specs) {
        const job: JobRecord = {
          jobId: randomUUID(),
          skillId: spec.skill.id,
          stages: [...spec.stages],
          state: 'queued',
          runId: null,
          outcome: null,
          error: null,
          enqueuedAt: nowIso(),
          startedAt: null,
          endedAt: null,
        }
        queued.push({ job, spec })
        ids.push(job.jobId)
        events.push({ type: 'job:queued', job: { ...job } })
      }
      pump()
      return ids
    },

    snapshot(): QueueSnapshot {
      return {
        concurrency,
        queued: queued.map((entry) => ({ ...entry.job })),
        running: [...running.values()].map((entry) => ({ ...entry.job })),
        completed: completed.map((job) => ({ ...job })),
      }
    },

    async cancelJob(jobId: string): Promise<void> {
      const index = queued.findIndex((entry) => entry.job.jobId === jobId)
      if (index !== -1) {
        const [entry] = queued.splice(index, 1)
        const job = (entry as Entry).job
        job.state = 'cancelled'
        // Design §11.4 row 1: nothing started, so there is no run directory and
        // no evidence to preserve. `finish` emits and re-pumps.
        finish(job)
        // Same reason as settleIdle's deferral: a caller awaiting cancelJob is
        // entitled to see the cancellation on the event stream once it returns.
        await new Promise((resolve) => setTimeout(resolve, 0))
        return
      }

      const active = running.get(jobId)
      if (!active) return

      // Set the state first so `drive` reports a cancellation rather than a
      // completion when the handle settles.
      active.job.state = 'cancelled'
      await active.handle.cancel('cancelled from the queue')
      await active.settled
    },

    resolveMutation(jobId, requestId, action) {
      running.get(jobId)?.handle.resolveMutation(requestId, action)
    },

    events,

    idle(): Promise<void> {
      if (queued.length === 0 && running.size === 0) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },

    close(): void {
      closed = true
      events.close()
    },
  }
}
