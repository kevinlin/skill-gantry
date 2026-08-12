import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/core/config/config.js'
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
  frontmatterReadable: true,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const job = (id: string, stages: Stage[] = ['security']): JobSpec => ({ skill: skill(id), stages })

function harness(concurrency: number) {
  const byJob = new Map<string, FakeRun>()
  const started: string[] = []
  const events: QueueEvent[] = []

  // Created on demand, so a test may settle a job the pool has not started yet.
  // Without that, finishing a whole batch in one loop would leave the last job
  // hanging: its run does not exist until a slot frees.
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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe('enqueue', () => {
  it('accepts a batch and returns one id per job — R5.5', async () => {
    const { queue, events } = harness(2)
    const ids = queue.enqueue([job('a'), job('b'), job('c')])
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    await tick()
    expect(events.filter((e) => e.type === 'job:queued')).toHaveLength(3)
    queue.close()
  })

  it('defaults to a limit of two — R5.6', () => {
    expect(DEFAULT_CONFIG.concurrency).toBe(2)
  })
})

describe('bounded worker pool', () => {
  it('never runs more than the configured limit — R5.6', async () => {
    const { queue, runs, started } = harness(2)
    const ids = queue.enqueue([job('a'), job('b'), job('c'), job('d')])
    await tick()
    expect(started).toEqual(['a', 'b'])
    expect(queue.snapshot().queued).toHaveLength(2)

    runs.get(ids[0]!)?.finish()
    await tick()
    expect(started).toEqual(['a', 'b', 'c'])

    for (const id of ids) runs.get(id)?.finish()
    await queue.idle()
    expect(started).toEqual(['a', 'b', 'c', 'd'])
    queue.close()
  })

  it('keeps running other skills when one fails — R5.8', async () => {
    const { queue, runs, events } = harness(2)
    const ids = queue.enqueue([job('a'), job('b'), job('c')])
    await tick()
    runs.get(ids[0]!)?.fail('ledger exploded')
    await tick()
    runs.get(ids[1]!)?.finish()
    runs.get(ids[2]!)?.finish()
    await queue.idle()

    const failed = events.filter((e) => e.type === 'job:failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.type === 'job:failed' && failed[0].job.error).toMatch(/ledger exploded/)
    expect(events.filter((e) => e.type === 'job:done')).toHaveLength(2)
    queue.close()
  })
})

describe('mutating stages', () => {
  it('never runs two at once whatever the limit says — R5.7', async () => {
    const { queue, runs, started } = harness(4)
    const ids = queue.enqueue([
      job('a', ['optimise']),
      job('b', ['optimise']),
      job('c', ['release']),
    ])
    await tick()
    expect(started).toEqual(['a'])
    expect(queue.snapshot().running).toHaveLength(1)

    runs.get(ids[0]!)?.finish()
    await tick()
    expect(started).toEqual(['a', 'b'])

    runs.get(ids[1]!)?.finish()
    await tick()
    runs.get(ids[2]!)?.finish()
    await queue.idle()
    expect(started).toEqual(['a', 'b', 'c'])
    queue.close()
  })

  it('lets a read-only job past a blocked mutating one', async () => {
    const { queue, runs, started } = harness(2)
    const ids = queue.enqueue([job('a', ['optimise']), job('b', ['optimise']), job('c')])
    await tick()
    expect(started).toEqual(['a', 'c'])
    for (const id of ids) runs.get(id)?.finish()
    await queue.idle()
    queue.close()
  })
})

describe('run events and snapshot', () => {
  it('forwards run events tagged with their job id', async () => {
    const { queue, runs, events } = harness(1)
    const [id] = queue.enqueue([job('a')])
    await tick()
    runs.get(id!)?.events.push({
      type: 'stage:start',
      runId: 'run-a',
      stage: 'security',
      toolIds: ['skillspector'],
    })
    await tick()
    const forwarded = events.find((e) => e.type === 'run:event')
    expect(forwarded).toMatchObject({ jobId: id, event: { type: 'stage:start' } })
    runs.get(id!)?.finish()
    await queue.idle()
    queue.close()
  })

  it('reports queued, running and completed with the run id — R5.10', async () => {
    const { queue, runs } = harness(1)
    const ids = queue.enqueue([job('a'), job('b')])
    await tick()
    expect(queue.snapshot()).toMatchObject({
      concurrency: 1,
      queued: [{ skillId: 'b', state: 'queued' }],
      running: [{ skillId: 'a', state: 'running' }],
    })
    runs.get(ids[0]!)?.finish({ outcome: 'failed' })
    await tick()
    expect(queue.snapshot().completed[0]).toMatchObject({
      skillId: 'a',
      state: 'done',
      outcome: 'failed',
      runId: 'run-a',
    })
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    queue.close()
  })

  it('runs one skill twice without interference — R5.3', async () => {
    const { queue, runs, started } = harness(1)
    const ids = queue.enqueue([job('a', ['security']), job('a', ['security'])])
    await tick()
    runs.get(ids[0]!)?.finish()
    await tick()
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    expect(started).toEqual(['a', 'a'])
    expect(queue.snapshot().completed.map((j) => j.state)).toEqual(['done', 'done'])
    queue.close()
  })

  it('enqueues nothing of its own accord — R5.4', async () => {
    const { queue, runs, started } = harness(2)
    const ids = queue.enqueue([job('a', ['optimise'])])
    await tick()
    runs.get(ids[0]!)?.finish()
    await queue.idle()
    await tick()
    expect(started).toEqual(['a'])
    expect(queue.snapshot().queued).toEqual([])
    queue.close()
  })
})
