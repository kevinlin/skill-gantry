import { describe, expect, it } from 'vitest'
import type { RawFinding } from '../../src/core/index.js'
import { findingRows, outputWindow } from '../../src/tui/rows.js'
import { initialState, reducer, type FindingRow } from '../../src/tui/store.js'

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId: 'SG101',
  severity: 'low',
  path: 'declawed/scripts/scan.py',
  message: 'subprocess.run called with shell=True on an interpolated path',
  ...over,
})

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  finding: raw(),
  stage: 'validate',
  toolId: 'skill-lint',
  artefactDir: '/runs/r1/01-validate/skill-lint',
  ...over,
})

describe('R11.14 findings pane rows', () => {
  it('renders one row per finding and expands only the selected one', () => {
    const rows = findingRows([row(), row({ finding: raw({ nativeRuleId: 'SG102' }) })], 0, 100)
    // Two summary rows plus the detail rows of the first.
    expect(rows.filter((r) => r.text.includes('unsafe-script')).length).toBeGreaterThanOrEqual(2)
    const detail = rows.map((r) => r.text).join('\n')
    expect(detail).toContain('subprocess.run called with shell=True')
    expect(detail).toContain('SG101')
    expect(detail).toContain('/runs/r1/01-validate/skill-lint')
    expect(detail).toContain('[o] open')
    // The unselected finding contributes its summary row and nothing else.
    expect(detail).not.toContain('SG102 ')
  })

  it('moves the detail with the cursor', () => {
    const rows = findingRows([row(), row({ finding: raw({ nativeRuleId: 'SG102' }) })], 1, 100)
    const text = rows.map((r) => r.text).join('\n')
    expect(text).toContain('SG102')
    expect(text).not.toContain('SG101 ·')
  })

  it('names the tool and the stage on the summary row, so a cursor is answerable', () => {
    const rows = findingRows([row()], 0, 100)
    expect(rows[0]?.text).toContain('▸')
    expect(rows[0]?.text).toContain('skill-lint')
  })

  it('shows the suppression justification instead of hiding the finding — R8.15', () => {
    const rows = findingRows(
      [row({ finding: raw({ suppressed: { justification: 'fixed paths' } }) })],
      0,
      100,
    )
    const text = rows.map((r) => r.text).join('\n')
    expect(text).toContain('⊘')
    expect(text).toContain('fixed paths')
  })

  it('is empty for no findings, so the pane can say so without a special case', () => {
    expect(findingRows([], 0, 100)).toEqual([])
  })

  it('never lets the cursor leave the window the pane renders', () => {
    const findings = Array.from({ length: 12 }, (_, i) =>
      row({ finding: raw({ nativeRuleId: `SG${i}` }) }),
    )
    let state = { ...initialState([], 2), panel: 'findings' as const }
    // Drive the cursor to the end and assert it stopped at the last finding.
    const skill = { findings } as never
    for (let i = 0; i < 40; i += 1) {
      state = reducer(state, { type: 'select-finding', delta: 1, total: findings.length })
    }
    const total = findingRows(findings, state.selectedFinding, 200).length
    const view = outputWindow(state, skill, 10)
    // The cursor indexes findings; the window counts rendered rows. Clamping
    // the cursor against the row count is what walked it past the last finding.
    expect(state.selectedFinding).toBe(findings.length - 1)
    expect(view.end).toBeLessThanOrEqual(total)
    // And the window contains the cursor's own row, which `anchor: 'top'`
    // could not express — it pinned the pane at row 0 with the cursor below it.
    expect(state.selectedFinding).toBeGreaterThanOrEqual(view.start)
    expect(state.selectedFinding).toBeLessThan(view.end)
  })
})
