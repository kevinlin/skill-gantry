import type { RunEvent } from '../../src/core/pipeline/events.js'
import { AsyncEventQueue } from '../../src/core/pipeline/queue.js'
import type { RunHandle, RunSummary } from '../../src/core/pipeline/run.js'

export interface FakeRun {
  handle: RunHandle
  events: AsyncEventQueue<RunEvent>
  /** Completes the run successfully. */
  finish(summary?: Partial<RunSummary>): void
  /** Fails the run, which is how R5.8 is exercised. */
  fail(message: string): void
  readonly cancelled: boolean
}

export function fakeRun(runId = 'run-1'): FakeRun {
  const events = new AsyncEventQueue<RunEvent>()
  const base: RunSummary = {
    runId,
    runDir: `/tmp/${runId}`,
    outcome: 'passed',
    skillDigest: 'sha256:0',
    stages: [],
    opened: 0,
    closed: 0,
    reopened: 0,
  }

  let settle!: (summary: RunSummary) => void
  let reject!: (err: Error) => void
  const done = new Promise<RunSummary>((res, rej) => {
    settle = res
    reject = rej
  })
  // The queue attaches its own handler; this one only stops an unhandled
  // rejection warning in the window before it does.
  void done.catch(() => undefined)

  const state = { cancelled: false }

  const handle: RunHandle = {
    runId: Promise.resolve(runId),
    events,
    resolveMutation: () => undefined,
    cancel: async () => {
      state.cancelled = true
      events.close()
      settle({ ...base, outcome: 'errored' })
    },
    done,
  }

  return {
    handle,
    events,
    finish: (summary = {}) => {
      events.close()
      settle({ ...base, ...summary })
    },
    fail: (message) => {
      events.close()
      reject(new Error(message))
    },
    get cancelled() {
      return state.cancelled
    },
  }
}
