import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/index.js'
import type { SkillRef } from '../../src/core/index.js'
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

function harness() {
  const runs = new Map<string, FakeRun>()
  const queue = createQueue({
    concurrency: 2,
    startRun: (job) => {
      const run = fakeRun(`run-${job.skillId}`)
      runs.set(job.jobId, run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App skills={SKILLS} queue={queue} stages={['security']} concurrency={2} views={fakeViews()} intervalMs={20} />,
  )
  return { queue, runs, ui }
}

describe('Work screen', () => {
  it('shows the skill list, the lifecycle rail and the output pane at once — R11.1', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    const frame = ui.lastFrame()

    expect(frame).toContain('declawed')
    expect(frame).toContain('spec-lint')
    for (const stage of ['Validate', 'Evaluate', 'Security', 'Optimise', 'Release']) {
      expect(frame).toContain(stage)
    }
    expect(frame).toContain('Log')
    expect(frame).toContain('Findings')

    ui.unmount()
    queue.close()
  })

  it('moves the selection with j and k', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/›\s*[○◐●!×]\s*spec-lint/)
    ui.stdin.send('k')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/›\s*[○◐●!×]\s*declawed/)
    ui.unmount()
    queue.close()
  })

  it('renders live stage state as the engine reports it', async () => {
    const { ui, queue, runs } = harness()
    await ui.settle()
    const [jobId] = queue.enqueue([{ skill: SKILLS[0]!, stages: ['security'] }])
    await ui.settle()

    const run = runs.get(jobId!)!
    run.events.push({
      type: 'run:start',
      runId: 'run-declawed',
      skillId: 'declawed',
      stages: ['security'],
      runDir: '/w/run-declawed',
    })
    run.events.push({
      type: 'stage:done',
      runId: 'run-declawed',
      stage: 'security',
      outcome: 'failed',
      result: { stage: 'security', outcome: 'failed', verdict: 'failed', toolRuns: [] },
    })
    await ui.settle(60)

    expect(ui.lastFrame()).toContain('failed')
    run.finish({ outcome: 'failed' })
    await queue.idle()
    ui.unmount()
    queue.close()
  })

  it('opens full help on ? and closes it on esc', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    expect(ui.lastFrame()).toContain('? help')

    ui.stdin.send('?')
    await ui.settle()
    expect(ui.lastFrame()).toContain('SkillGantry — keys')
    expect(ui.lastFrame()).toContain('cycle focus')

    ui.stdin.send('') // esc
    await ui.settle()
    expect(ui.lastFrame()).not.toContain('SkillGantry — keys')
    expect(ui.lastFrame()).toContain('declawed')
    ui.unmount()
    queue.close()
  })

  it('leaves the selection alone while help is open', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('?')
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send('?')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/›\s*[○◐●!×]\s*declawed/)
    ui.unmount()
    queue.close()
  })

  it('renders streamed log lines through the pump, not per chunk', async () => {
    const { ui, queue, runs } = harness()
    await ui.settle()
    const [jobId] = queue.enqueue([{ skill: SKILLS[0]!, stages: ['security'] }])
    await ui.settle()

    const run = runs.get(jobId!)!
    run.events.push({
      type: 'run:start',
      runId: 'run-declawed',
      skillId: 'declawed',
      stages: ['security'],
      runDir: '/w/run-declawed',
    })
    for (let i = 0; i < 40; i += 1) {
      run.events.push({
        type: 'tool:output',
        runId: 'run-declawed',
        stage: 'security',
        toolId: 'skillspector',
        stream: 'stdout',
        chunk: `scanning file ${i}\n`,
      })
    }
    await ui.settle(80)

    expect(ui.lastFrame()).toContain('skillspector │ scanning file 39')
    run.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })
})
