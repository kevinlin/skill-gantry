import { describe, expect, it } from 'vitest'
import { createQueue, type IssueRow, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const issue = (over: Partial<IssueRow>): IssueRow => ({
  fingerprint: 'fp000000abcd',
  skillId: 'alpha/declawed',
  repoId: 'alpha',
  ruleClass: 'prompt-injection',
  relPath: 'declawed/SKILL.md',
  severity: 'high',
  state: 'open',
  occurrenceCount: 2,
  detectors: ['skillspector', 'skill-scanner'],
  blockedBy: ['skill-scanner'],
  lastSeenRun: '019283af-0000-7000-8000-000000000001',
  ...over,
})

const ROWS = [
  issue({}),
  issue({
    fingerprint: 'fp111111beef',
    skillId: 'beta/spec-lint',
    repoId: 'beta',
    ruleClass: 'metadata-invalid',
    relPath: 'spec-lint/SKILL.md',
    severity: 'low',
    detectors: ['skill-lint'],
    blockedBy: [],
  }),
]

async function onIssues(rows: IssueRow[] = ROWS, size = { columns: 100, rows: 30 }) {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews({ issues: async () => rows })
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    size,
  )
  await ui.settle()
  ui.stdin.send(':')
  for (const char of 'issues') ui.stdin.send(char)
  ui.stdin.send('\r')
  await ui.settle(40)
  return { ui, views }
}

describe('Issues screen — R11.3, across every registered repo', () => {
  it('lists issues from both repos with severity, state and path', async () => {
    const { ui } = await onIssues()
    const frame = ui.lastFrame()
    for (const expected of ['alpha/declawed', 'beta/spec-lint', 'prompt-injection', 'high']) {
      expect(frame).toContain(expected)
    }
    ui.unmount()
  })

  it('names the detector holding an issue open, which is the one reconcile waits on', async () => {
    const { ui } = await onIssues()
    expect(ui.lastFrame()).toContain('skill-scanner')
    ui.unmount()
  })

  it('acknowledges the selected issue', async () => {
    const { ui, views } = await onIssues()
    ui.stdin.send('a')
    await ui.settle(40)
    expect(views.actions).toEqual([['fp000000abcd', 'acknowledge']])
    ui.unmount()
  })

  it('marks wontfix and reopens through the same path', async () => {
    const { ui, views } = await onIssues()
    ui.stdin.send('w')
    await ui.settle(40)
    ui.stdin.send('o')
    await ui.settle(40)
    expect(views.actions.map(([, action]) => action)).toEqual(['wontfix', 'reopen'])
    ui.unmount()
  })

  it('acts on the row under the cursor, not the first one', async () => {
    const { ui, views } = await onIssues()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send('a')
    await ui.settle(40)
    expect(views.actions).toEqual([['fp111111beef', 'acknowledge']])
    ui.unmount()
  })

  it('re-reads the list after a transition rather than patching a row in place', async () => {
    // A patched row the filter no longer admits stays on screen and cannot be
    // acted on again, so the transition asks the ledger what it now matches.
    let calls = 0
    const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
    const views = fakeViews({
      issues: async () => {
        calls += 1
        return ROWS
      },
    })
    const ui = renderInk(
      <App
        skills={[] as SkillRef[]}
        queue={queue}
        stages={['security']}
        concurrency={1}
        views={views}
        intervalMs={20}
      />,
    )
    await ui.settle()
    ui.stdin.send(':')
    for (const char of 'issues') ui.stdin.send(char)
    ui.stdin.send('\r')
    await ui.settle(40)
    const before = calls
    ui.stdin.send('a')
    await ui.settle(60)
    expect(calls).toBeGreaterThan(before)
    ui.unmount()
  })

  it('cycles the state filter', async () => {
    const { ui } = await onIssues()
    ui.stdin.send('f')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('open')
    ui.unmount()
  })

  it('says so when nothing matches rather than rendering an empty frame', async () => {
    const { ui } = await onIssues([])
    expect(ui.lastFrame()).toContain('no issues')
    ui.unmount()
  })

  it('fits an 80x24 and a 50x14 terminal', async () => {
    for (const size of [
      { columns: 80, rows: 24 },
      { columns: 50, rows: 14 },
    ]) {
      const { ui } = await onIssues(ROWS, size)
      expect(ui.lastFrame().split('\n').length).toBeLessThanOrEqual(size.rows)
      ui.unmount()
    }
  })
})
