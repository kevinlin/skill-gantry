import { describe, expect, it } from 'vitest'
import {
  MIN_COLUMNS,
  MIN_ROWS,
  OVERVIEW_ROWS,
  layoutFor,
  SKILL_LIST_MIN,
} from '../../src/tui/layout.js'
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
    // Bracketed, so a digit in a column of counts reads as a key (R11.12, rev 15).
    expect(text).toContain('[0] full dashboard')
    // Six rows exactly, which is what `OVERVIEW_ROWS.full` allocated it.
    expect(rows).toHaveLength(6)
  })

  it('compact is the bars and the way to the dashboard', () => {
    const rows = overviewRows(stats, 'compact', 28).map((row) => row.text)
    expect(rows).toHaveLength(4)
    // The key was on the largest tier alone, so below 24 terminal rows nothing
    // on screen named it (R11.12, rev 15).
    expect(rows.join('\n')).toContain('[0] full dashboard')
  })

  // Nothing pinned these together before: `compact` was 3 and the builder
  // emitted 3 only because `GATE_STAGES` happens to be three long, so a tier
  // allocated a row its builder never fills would have shipped unnoticed.
  it.each(['full', 'compact'] as const)('allocates %s exactly the rows it emits', (tier) => {
    expect(overviewRows(stats, tier, 28)).toHaveLength(OVERVIEW_ROWS[tier])
  })

  // `stagePassRates` reports the stages that have rows, which is neither the
  // gates nor a fixed count: one `validate` run gives one, and `optimise` or
  // `release` add rows the card has no space for. Driving the bars off it
  // under-filled the tier from the populated side while the empty card had
  // already been fixed — so both now run through `GATE_STAGES`.
  it('keeps one bar per gate when the ledger has run some stages and not others', () => {
    const partial = {
      ...stats,
      runs: 3,
      stagePassRates: [
        { stage: 'validate' as const, runs: 3, passed: 3, rate: 1 },
        { stage: 'optimise' as const, runs: 2, passed: 1, rate: 0.5 },
      ],
    }
    const rows = overviewRows(partial, 'compact', 28)
    expect(rows).toHaveLength(OVERVIEW_ROWS.compact)
    const text = rows.map((row) => row.text).join('\n')
    for (const stage of ['validate', 'evaluate', 'security']) expect(text).toContain(stage)
    expect(text).not.toContain('optimise')
    // The two unrun gates read as unrun, not as gates that fail everything.
    expect(text.match(/—/g)).toHaveLength(2)
  })

  // The one screen a new maintainer meets first. It emitted a single dim line
  // into a tier allocated four or six rows, and dropped `[0]` — the only key
  // the card advertises — exactly when they were newest.
  describe('with nothing run yet', () => {
    const fresh = { ...emptyDashboard, repos: 1, skills: 8, runs: 0 }

    it.each(['full', 'compact'] as const)('fills %s with the gantry unlit', (tier) => {
      const rows = overviewRows(fresh, tier, 28)
      expect(rows).toHaveLength(OVERVIEW_ROWS[tier])
      const text = rows.map((r) => r.text).join('\n')
      for (const stage of ['validate', 'evaluate', 'security']) expect(text).toContain(stage)
      expect(text).toContain(bar(0, 10))
      // `—`, never `0%`: a stage nobody has run has no pass rate, which is a
      // different fact from a stage that fails everything.
      expect(text).not.toContain('0%')
      expect(text).toContain('—')
      expect(text).toContain('[0] full dashboard')
    })

    it('never paints an unrun gate as a failing one', () => {
      // `failed`'s red over a stage nobody touched is the same lie `0%` would
      // be, in colour. Only the dashboard link claims one.
      const coloured = overviewRows(fresh, 'full', 28).filter((r) => r.colour !== undefined)
      expect(coloured.map((r) => r.text)).toEqual([
        expect.stringContaining('[0] full dashboard'),
      ])
    })

    it('names the count and the keys, phrased to the column it is given', () => {
      expect(overviewRows(fresh, 'full', 28).map((r) => r.text)).toContain(
        'nothing run yet · 8 skills',
      )
      // 18 cells is the card's floor — the 22-cell list column the whole 76–109
      // band uses, less `Panel`'s chrome. Nothing may truncate there, and the
      // clause leads so that a four-digit repo cuts the count, not the fact.
      const narrow = overviewRows(fresh, 'full', 18).map((r) => r.text)
      expect(narrow).toContain('no runs · 8 skills')
      for (const text of narrow) expect(text.length).toBeLessThanOrEqual(18)
      // The sentence rows say it whole at the floor. `[0] full dashboard →`
      // still elides there, as it did before this and does with a measured
      // card: shortening the one row that names a key is the trade §14.1's
      // footer rule already refuses.
      expect(narrow.filter((text) => text.includes('…'))).toEqual([
        expect.stringContaining('[0] full dashboar'),
      ])
    })

    it('still says the two keys that produce a run, in the footer’s own words', () => {
      // `space mark · r run` is `HINTS` verbatim and measures the card's floor
      // exactly, so the row that names the way out is not the row that cuts.
      expect(overviewRows(fresh, 'full', 18).map((r) => r.text)).toContain('space mark · r run')
      // Not on `compact`: those four rows are the bars and the way out.
      expect(overviewRows(fresh, 'compact', 28)).toHaveLength(OVERVIEW_ROWS.compact)
    })
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
    // Walked *downward*, which is the direction the tier shrinks in. Upward it
    // is monotone none → compact → full, so the earlier version of this loop
    // never reached its assertion once — a test that described the rule and
    // proved nothing.
    // What the card costs the left column: its tier plus `Panel`'s own border
    // and title rows, and nothing at all when it does not render.
    const cost = {
      full: OVERVIEW_ROWS.full + 2,
      compact: OVERVIEW_ROWS.compact + 2,
      none: 0,
    } as const
    let previous: { tier: keyof typeof cost; skillRows: number } | null = null
    let boundaries = 0
    for (let rows = 60; rows >= MIN_ROWS; rows -= 1) {
      const layout = layoutFor(110, rows)
      if (layout.mode !== 'standard') continue
      if (previous !== null && previous.tier !== layout.overview) {
        boundaries += 1
        // The terminal lost one row on the way here, so the list keeps what the
        // card gave up, less that one.
        expect(layout.skillRows - previous.skillRows).toBe(
          cost[previous.tier] - cost[layout.overview] - 1,
        )
      }
      previous = { tier: layout.overview, skillRows: layout.skillRows }
    }
    // The loop has to actually cross both boundaries, or it is dead again.
    expect(boundaries).toBe(2)
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
