import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/index.js'
import type { IssueRow, RawFinding, ToolRunRecord } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk, waitForFrame } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const skill = skillRef('declawed')

const finding: RawFinding = {
  ruleClass: 'unsafe-script',
  nativeRuleId: 'MP2',
  severity: 'medium',
  path: 'declawed/scripts/scan.py',
  message: 'alignment whitespace in a re.VERBOSE block',
}

const toolRun: ToolRunRecord = {
  toolId: 'skillspector',
  toolVersion: '2.5.1',
  outcome: 'failed',
  exitCode: 1,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/repo/declawed-workspace/skillgantry/runs/r1/03-security/skillspector',
  findings: [finding],
  metrics: {},
  summary: '1 finding',
}

const issue: IssueRow = {
  fingerprint: 'fp-1',
  skillId: 'declawed',
  repoId: 'fx',
  ruleClass: 'unsafe-script',
  relPath: 'declawed/scripts/scan.py',
  severity: 'medium',
  state: 'open',
  occurrenceCount: 1,
  detectors: ['skillspector'],
  blockedBy: ['skillspector'],
  lastSeenRun: 'r1',
  lastSeenRunDir: '2026-08-11_17-40-46',
  suppressed: false,
  suppressionReason: null,
}

function mount(views: ReturnType<typeof fakeViews>, runs?: Map<string, FakeRun>) {
  const queue = createQueue({
    concurrency: 1,
    startRun: (job) => {
      const run = fakeRun('r1')
      runs?.set(job.jobId, run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App
      skills={[skill]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    { columns: 110, rows: 30 },
  )
  return { queue, ui }
}

describe('R11.16 both surfaces reach one action', () => {
  it('opens the pane from the Findings pane, carrying that finding’s tool and rule', async () => {
    const views = fakeViews()
    const runs = new Map<string, FakeRun>()
    const { queue, ui } = mount(views, runs)
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)
    const run = [...runs.values()][0] as FakeRun
    run.events.push({
      type: 'run:start',
      runId: 'r1',
      skillId: 'declawed',
      stages: ['security'],
      runDir: '/runs/r1',
    })
    await ui.settle()
    run.events.push({
      type: 'tool:done',
      runId: 'r1',
      stage: 'security',
      toolId: 'skillspector',
      result: toolRun,
    })
    await ui.settle(40)

    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('2')
    await waitForFrame(ui, (frame) => frame.includes('unsafe-script'))
    ui.stdin.send('s')
    await waitForFrame(ui, (frame) => frame.includes('Suppress —'))

    // The reason editor is up and nothing has been staged yet: the reason is
    // part of the entry, so previewing before it is committed would stage a
    // diff with the prefill in it.
    expect(views.suppressions).toEqual([])
    expect(ui.lastFrame()).toContain('via SkillGantry')

    ui.stdin.send('\r')
    await waitForFrame(ui, (frame) => frame.includes('id: MP2'))
    expect(views.suppressions).toEqual([
      {
        kind: 'finding',
        skillId: 'declawed',
        toolId: 'skillspector',
        nativeRuleId: 'MP2',
        relPath: 'declawed/scripts/scan.py',
        reason: expect.stringContaining('via SkillGantry') as unknown as string,
      },
    ])

    ui.stdin.send('a')
    await ui.settle(40)
    expect(views.suppressResolutions).toEqual(['apply'])
    // R8.15's line: the mark is a cache recomputed on a conclusive run, so a
    // user who is not told this applies and concludes nothing happened.
    expect(ui.lastFrame()).toContain('after the re-run')
    ui.unmount()
    queue.close()
  })

  it('opens the pane from the Issues screen, carrying the fingerprint', async () => {
    const views = fakeViews({ issues: async () => [issue] })
    const { queue, ui } = mount(views)
    await ui.settle()
    ui.stdin.send(':')
    await ui.settle()
    for (const ch of 'issues') ui.stdin.send(ch)
    await ui.settle()
    ui.stdin.send('\r')
    await waitForFrame(ui, (frame) => frame.includes('unsafe-script'))

    ui.stdin.send('s')
    await waitForFrame(ui, (frame) => frame.includes('Suppress —'))
    ui.stdin.send('\r')
    await ui.settle(40)
    expect(views.suppressions[0]).toMatchObject({
      kind: 'issue',
      skillId: 'declawed',
      fingerprint: 'fp-1',
    })

    // `d` discards, and the staged bytes go with it — R10.12 leaves nothing
    // behind when the answer is no.
    ui.stdin.send('d')
    await ui.settle(40)
    expect(views.suppressResolutions).toEqual(['discard'])
    expect(ui.lastFrame()).not.toContain('Suppress —')
    ui.unmount()
    queue.close()
  })

  it('refuses an empty reason rather than staging one', async () => {
    const views = fakeViews({ issues: async () => [issue] })
    const { queue, ui } = mount(views)
    await ui.settle()
    ui.stdin.send(':')
    await ui.settle()
    for (const ch of 'issues') ui.stdin.send(ch)
    await ui.settle()
    ui.stdin.send('\r')
    await waitForFrame(ui, (frame) => frame.includes('unsafe-script'))
    ui.stdin.send('s')
    await waitForFrame(ui, (frame) => frame.includes('Suppress —'))

    // Clear the prefill one keystroke at a time, as a user would.
    for (let i = 0; i < 40; i += 1) ui.stdin.send('\x7f')
    await ui.settle(40)
    ui.stdin.send('\r')
    await waitForFrame(ui, (frame) => frame.includes('reason is required'))
    expect(views.suppressions).toEqual([])
    ui.unmount()
    queue.close()
  })
})
