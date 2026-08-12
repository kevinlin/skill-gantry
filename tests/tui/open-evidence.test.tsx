import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/index.js'
import type { RawFinding, ToolRunRecord } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const skill = skillRef('declawed')

const ARTEFACT_DIR = '/repo/declawed-workspace/skillgantry/runs/r1/01-validate/skill-lint'

const finding: RawFinding = {
  ruleClass: 'unsafe-script',
  nativeRuleId: 'SG101',
  severity: 'medium',
  path: 'declawed/scripts/scan.py',
  message: 'shell=True on an interpolated path',
}

const toolRun: ToolRunRecord = {
  toolId: 'skill-lint',
  toolVersion: '1.0.0',
  outcome: 'failed',
  exitCode: 1,
  durationMs: 10,
  errorKind: null,
  artefactDir: ARTEFACT_DIR,
  findings: [finding],
  metrics: {},
  summary: '1 finding',
}

describe('R11.14 open evidence', () => {
  // The assertion is on the **port**, never on a spawn — `src/tui/**` may not
  // spawn, and that is precisely why this is a port method.
  it('opens the selected finding’s artefact directory through the port', async () => {
    const views = fakeViews()
    const runs = new Map<string, FakeRun>()
    const queue = createQueue({
      concurrency: 1,
      startRun: (job) => {
        const run = fakeRun('r1')
        runs.set(job.jobId, run)
        return run.handle
      },
    })
    const ui = renderInk(
      <App
        skills={[skill]}
        queue={queue}
        stages={['validate']}
        concurrency={1}
        views={views}
        intervalMs={20}
      />,
      { columns: 110, rows: 30 },
    )
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)
    const run = [...runs.values()][0] as FakeRun
    run.events.push({
      type: 'run:start',
      runId: 'r1',
      skillId: 'declawed',
      stages: ['validate'],
      runDir: '/runs/r1',
    })
    await ui.settle()
    run.events.push({
      type: 'tool:done',
      runId: 'r1',
      stage: 'validate',
      toolId: 'skill-lint',
      result: toolRun,
    })
    await ui.settle(40)

    // Focus the work zone, open the Findings tab, then act on the finding.
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('2')
    await waitForFrame(ui, (frame) => frame.includes('unsafe-script'))
    ui.stdin.send('o')
    await ui.settle(40)

    expect(views.opened).toEqual([ARTEFACT_DIR])
    ui.unmount()
    queue.close()
  })

  it('leaves `o` unbound on the Issues tab, whose keys stay on the Issues screen', async () => {
    const views = fakeViews()
    const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
    const ui = renderInk(
      <App
        skills={[skill]}
        queue={queue}
        stages={['validate']}
        concurrency={1}
        views={views}
        intervalMs={20}
      />,
      { columns: 110, rows: 30 },
    )
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('3')
    await ui.settle(40)
    ui.stdin.send('o')
    await ui.settle(40)
    expect(views.opened).toEqual([])
    ui.unmount()
    queue.close()
  })
})
