import { describe, expect, it } from 'vitest'
import type { IssueRow } from '../../src/core/index.js'
import { issueRows } from '../../src/tui/rows.js'
import { PANELS, initialState, reducer } from '../../src/tui/store.js'

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
})
