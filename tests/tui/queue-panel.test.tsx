import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeViews } from '../helpers/fake-views.js'

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

const SKILLS = [skill('declawed'), skill('spec-lint')]

function harness(concurrency = 1) {
  const byJob = new Map<string, FakeRun>()
  // Created on demand, so a test may settle a job the pool has not started yet.
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
    startRun: (job) => ensure(job.jobId, job.skillId).handle,
  })
  const ui = renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      stages={['security']}
      concurrency={concurrency}
      views={fakeViews()} intervalMs={20}
    />,
  )
  return { queue, runs, ui }
}

describe('queue panel — R5.10, R11.6', () => {
  it('shows queued and running jobs on the Work screen', async () => {
    const { ui, queue, runs } = harness(1)
    await ui.settle()
    const ids = queue.enqueue([
      { skill: SKILLS[0]!, stages: ['security'] },
      { skill: SKILLS[1]!, stages: ['security'] },
    ])
    await ui.settle(40)

    const frame = ui.lastFrame()
    expect(frame).toContain('Queue')
    expect(frame).toMatch(/running\s+declawed/)
    expect(frame).toMatch(/queued\s+spec-lint/)

    for (const id of ids) runs.get(id)?.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })

  it('counts a running job up and keeps what a finished one cost', async () => {
    const { ui, queue, runs } = harness(1)
    await ui.settle()
    const ids = queue.enqueue([{ skill: SKILLS[0]!, stages: ['security'] }])
    await ui.settle(40)

    // A stage run is minutes long and its log can go quiet, so the row has to
    // say something that is still changing.
    expect(ui.lastFrame()).toMatch(/running\s+declawed security\s+\d+ms/)

    runs.get(ids[0]!)?.finish()
    await queue.idle()
    await ui.settle(40)
    // `passed`, not the job's own `done`: the pool ends every completed run
    // `done`, verdict included, so the row has to name the verdict.
    expect(ui.lastFrame()).toMatch(/passed\s+declawed security\s+\d+ms/)

    ui.unmount()
    queue.close()
  })

  it('cancels the selected job with x', async () => {
    const { ui, queue, runs } = harness(1)
    await ui.settle()
    const ids = queue.enqueue([
      { skill: SKILLS[0]!, stages: ['security'] },
      { skill: SKILLS[1]!, stages: ['security'] },
    ])
    await ui.settle(40)

    // Focus the queue — skills → work → queue (R11.11) — then move to the
    // second job and cancel it. `x` is inert outside this zone.
    ui.stdin.send('\t')
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send('x')
    await ui.settle(40)

    expect(queue.snapshot().queued).toEqual([])
    expect(queue.snapshot().completed.map((job) => job.state)).toContain('cancelled')
    expect(ui.lastFrame()).toMatch(/cancelled\s+spec-lint/)

    runs.get(ids[0]!)?.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })
})
