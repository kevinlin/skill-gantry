import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/queue/pool.js'
import type { JobSpec, QueueEvent } from '../../src/core/queue/types.js'
import type { SkillRef, Stage } from '../../src/core/types.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const job = (id: string, stages: Stage[] = ['security']): JobSpec => ({ skill: skill(id), stages })
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

function harness(concurrency: number) {
  const byJob = new Map<string, FakeRun>()
  const started: string[] = []
  const events: QueueEvent[] = []

  const ensure = (jobId: string, skillId?: string): FakeRun => {
    const existing = byJob.get(jobId)
    if (existing) return existing
    const run = fakeRun(`run-${skillId ?? jobId}`)
    byJob.set(jobId, run)
    return run
  }
  const runs = { get: (jobId: string): FakeRun => ensure(jobId) }

  const queue = createQueue({
    concurrency,
    startRun: (record) => {
      started.push(record.skillId)
      return ensure(record.jobId, record.skillId).handle
    },
  })
  void (async () => {
    for await (const event of queue.events) events.push(event)
  })()
  return { queue, runs, started, events }
}

describe('cancelJob', () => {
  it('removes a queued job without ever starting it', async () => {
    const { queue, started, events } = harness(1)
    const ids = queue.enqueue([job('a'), job('b')])
    await tick()
    await queue.cancelJob(ids[1]!)

    expect(started).toEqual(['a'])
    expect(queue.snapshot().queued).toEqual([])
    expect(events.filter((e) => e.type === 'job:cancelled')).toHaveLength(1)
    expect(queue.snapshot().completed[0]).toMatchObject({ skillId: 'b', state: 'cancelled' })
    queue.close()
  })

  it('cancels a running job through its run handle and waits for it to settle', async () => {
    const { queue, runs, events } = harness(1)
    const ids = queue.enqueue([job('a')])
    await tick()
    await queue.cancelJob(ids[0]!)

    expect(runs.get(ids[0]!)?.cancelled).toBe(true)
    expect(queue.snapshot().running).toEqual([])
    const cancelled = events.filter((e) => e.type === 'job:cancelled')
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]?.type === 'job:cancelled' && cancelled[0].job.state).toBe('cancelled')
    queue.close()
  })

  it('starts the next job once a running one is cancelled', async () => {
    const { queue, started, runs } = harness(1)
    const ids = queue.enqueue([job('a'), job('b')])
    await tick()
    await queue.cancelJob(ids[0]!)
    await tick()
    expect(started).toEqual(['a', 'b'])
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    queue.close()
  })

  it('is a no-op for an unknown or already completed job', async () => {
    const { queue, runs } = harness(1)
    const ids = queue.enqueue([job('a')])
    await tick()
    runs.get(ids[0]!)?.finish()
    await queue.idle()

    await expect(queue.cancelJob(ids[0]!)).resolves.toBeUndefined()
    await expect(queue.cancelJob('not-a-job')).resolves.toBeUndefined()
    queue.close()
  })

  it('frees the mutation slot when a mutating job is cancelled', async () => {
    const { queue, started, runs } = harness(2)
    const ids = queue.enqueue([job('a', ['optimise']), job('b', ['optimise'])])
    await tick()
    expect(started).toEqual(['a'])
    await queue.cancelJob(ids[0]!)
    await tick()
    expect(started).toEqual(['a', 'b'])
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    queue.close()
  })
})
