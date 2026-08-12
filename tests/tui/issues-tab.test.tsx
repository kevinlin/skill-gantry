import { describe, expect, it } from 'vitest'
import { createQueue, type IssueRow } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { issueRows } from '../../src/tui/rows.js'
import { PANELS, initialState, reducer } from '../../src/tui/store.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const issue = (over: Partial<IssueRow> = {}): IssueRow => ({
  fingerprint: 'fp1',
  skillId: 'declawed',
  repoId: 'zapac',
  ruleClass: 'unsafe-script',
  relPath: 'declawed/scripts/scan.py',
  severity: 'low',
  state: 'open',
  occurrenceCount: 1,
  detectors: ['skill-lint'],
  blockedBy: [],
  lastSeenRun: 'run1',
  lastSeenRunDir: '2026-08-11_17-40-46',
  suppressed: false,
  suppressionReason: null,
  ...over,
})

describe('R11.13 Issues on the output pane', () => {
  it('puts Issues third, so Log and Findings keep the keys they had', () => {
    expect([...PANELS]).toEqual(['log', 'findings', 'issues', 'artefacts', 'skill'])
  })

  // 160 rather than 100: the suppression mark's own budget is a share of the
  // path column, so at 100 cells the *reason* is elided — which is the shipped
  // Issues-screen behaviour this builder preserves, not something to widen.
  it('builds one row per issue, marking the selection and the suppression', () => {
    const rows = issueRows(
      [issue(), issue({ fingerprint: 'fp2', suppressed: true, suppressionReason: 'fixed paths' })],
      1,
      160,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text).toContain('unsafe-script')
    expect(rows[0]?.text).toContain('declawed')
    expect(rows[0]?.text.startsWith(' ')).toBe(true)
    expect(rows[1]?.text).toContain('▸')
    expect(rows[1]?.suppressed).toBe(true)
    expect(rows[1]?.text).toContain('⊘ suppressed: fixed paths')
  })

  it('names R8.8 blockers on the row, so "why is this still open" is visible', () => {
    const rows = issueRows([issue({ blockedBy: ['skillspector'] })], 0, 100)
    expect(rows[0]?.text).toContain('⟂ skillspector')
  })

  it('cycles the scope skill → repo → all → skill', () => {
    let state = initialState([], 2)
    expect(state.issueScope).toBe('skill')
    state = reducer(state, { type: 'cycle-issue-scope' })
    expect(state.issueScope).toBe('repo')
    state = reducer(state, { type: 'cycle-issue-scope' })
    expect(state.issueScope).toBe('all')
    state = reducer(state, { type: 'cycle-issue-scope' })
    expect(state.issueScope).toBe('skill')
  })

  // R11.13, rev 15. The tab used to render `state.selectedIssue` while
  // windowing against `outputOffset`, so it drew a cursor the Work screen
  // could not move and the Issues screen's cursor moved under it instead.
  it('moves its own cursor, leaving the Issues screen where the user left it', async () => {
    const skill = skillRef('declawed', {
      repo: { id: 'zapac', path: '/repo', name: 'zapac', isGit: false },
    })
    const rows = [
      issue({ relPath: 'declawed/scripts/scan.py' }),
      issue({ fingerprint: 'fp2', relPath: 'declawed/scripts/other.py' }),
    ]
    const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('run-1').handle })
    const ui = renderInk(
      <App
        skills={[skill]}
        queue={queue}
        stages={['security']}
        concurrency={1}
        views={fakeViews({ issues: async () => rows })}
        intervalMs={20}
      />,
      { columns: 160, rows: 30 },
    )
    await ui.settle(60)
    ui.stdin.send('3')
    await ui.settle(60)
    ui.stdin.send('j')
    await ui.settle(40)
    expect(ui.lastFrame()).toMatch(/▸.*other\.py/)

    // The Issues screen was never touched, so its own cursor is still row one.
    ui.stdin.send(':')
    await ui.settle()
    ui.stdin.send('issues')
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(60)
    expect(ui.lastFrame()).toMatch(/▸.*scan\.py/)
    expect(ui.lastFrame()).not.toMatch(/▸.*other\.py/)
    ui.unmount()
    queue.close()
  })
})
