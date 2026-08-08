import { describe, expect, it } from 'vitest'
import { MIN_COLUMNS, MIN_ROWS, layoutFor, SKILL_LIST_MIN } from '../../src/tui/layout.js'
import { bar, overviewRows } from '../../src/tui/rows.js'
import { Work } from '../../src/tui/components/Work.js'
import { initialState } from '../../src/tui/store.js'
import { emptyDashboard, fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

void fakeViews

const stats = {
  ...emptyDashboard,
  repos: 1,
  skills: 18,
  runs: 21,
  stagePassRates: [
    { stage: 'validate' as const, runs: 9, passed: 8, rate: 8 / 9 },
    { stage: 'evaluate' as const, runs: 7, passed: 2, rate: 2 / 7 },
    { stage: 'security' as const, runs: 14, passed: 3, rate: 3 / 14 },
  ],
  openBySeverity: [
    { severity: 'high' as const, count: 1 },
    { severity: 'low' as const, count: 4 },
  ],
}

describe('R11.12 Overview card', () => {
  it('draws a proportional bar with the DESIGN.md glyphs', () => {
    expect(bar(0, 10)).toBe('▕░░░░░░░░░░▏')
    expect(bar(1, 10)).toBe('▕██████████▏')
    expect(bar(0.5, 10)).toBe('▕█████░░░░░▏')
  })

  it('full names every stage, the issue mix and the way to the dashboard', () => {
    const rows = overviewRows(stats, 'full', 28).map((row) => row.text)
    const text = rows.join('\n')
    expect(text).toContain('validate')
    expect(text).toContain('89%')
    expect(text).toContain('1 high')
    // The key first, then what it reaches: the card is where `0` is advertised,
    // because `HINTS` is already seven pairs and an eighth truncates `q quit`.
    expect(text).toContain('0  full dashboard')
    // Six rows exactly, which is what `OVERVIEW_ROWS.full` allocated it.
    expect(rows).toHaveLength(6)
  })

  it('compact is the bars alone', () => {
    const rows = overviewRows(stats, 'compact', 28).map((row) => row.text)
    expect(rows).toHaveLength(3)
    expect(rows.join('\n')).not.toContain('dashboard')
  })

  it('leaves the skill list at or above its minimum at every size', () => {
    for (let rows = MIN_ROWS; rows <= 60; rows += 1) {
      for (const columns of [MIN_COLUMNS, 80, 110, 200]) {
        const layout = layoutFor(columns, rows)
        if (layout.mode !== 'standard' || layout.overview === 'none') continue
        expect(layout.skillRows).toBeGreaterThanOrEqual(SKILL_LIST_MIN)
      }
    }
  })

  it('returns the rows it gives up when the tier shrinks', () => {
    // Same width, one row shorter at a tier boundary: the list must not lose
    // rows to a card that just got smaller.
    let previous: { rows: number; tier: string; skillRows: number } | null = null
    for (let rows = MIN_ROWS; rows <= 60; rows += 1) {
      const layout = layoutFor(110, rows)
      if (layout.mode !== 'standard') continue
      if (previous && previous.tier !== layout.overview && layout.overview === 'none') {
        expect(layout.skillRows).toBeGreaterThan(previous.skillRows)
      }
      previous = { rows, tier: layout.overview, skillRows: layout.skillRows }
    }
  })

  it('never shows the card in narrow, which has no column to put it in', () => {
    expect(layoutFor(60, 40).overview).toBe('none')
  })

  it('renders inside the terminal at 80x24 and at 50x14', () => {
    for (const [columns, rows] of [
      [80, 24],
      [50, 14],
      [110, 34],
    ] as const) {
      const ui = renderInk(<Work state={{ ...initialState([], 2), dashboard: stats }} />, {
        columns,
        rows,
      })
      const frame = ui.lastFrame()
      ui.unmount()
      const lines = frame.split('\n').filter((line) => line.length > 0)
      expect(lines.length).toBeLessThanOrEqual(rows)
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns)
    }
  })
})
