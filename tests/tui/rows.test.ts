import { describe, expect, it } from 'vitest'
import { dashboardRows, humanMs } from '../../src/tui/rows.js'
import { initialState, reducer } from '../../src/tui/store.js'
import { emptyDashboard } from '../helpers/fake-views.js'

const loaded = (stats = emptyDashboard) =>
  reducer(initialState([], 2), { type: 'set-dashboard', stats })

describe('humanMs', () => {
  it('picks the magnitude a stage actually takes', () => {
    expect(humanMs(900)).toBe('900ms')
    expect(humanMs(2_500)).toBe('2.5s')
    expect(humanMs(65_000)).toBe('1m 05s')
    expect(humanMs(null)).toBe('—')
  })
})

describe('dashboardRows', () => {
  it('says it is loading rather than showing zeros', () => {
    expect(dashboardRows(initialState([], 2), 80)[0]?.text).toContain('loading')
  })

  it('distinguishes an empty ledger from an unloaded one', () => {
    expect(
      dashboardRows(loaded(), 80)
        .map((row) => row.text)
        .join('\n'),
    ).toContain('no runs recorded')
  })

  it('renders every R8.9 clause as its own section', () => {
    const rows = dashboardRows(
      loaded({
        ...emptyDashboard,
        repos: 2,
        skills: 3,
        runs: 4,
        stagePassRates: [{ stage: 'validate', runs: 4, passed: 3, rate: 0.75 }],
        wallClock: [{ stage: 'validate', runs: 4, medianMs: 2_500, maxMs: 9_000 }],
        evalCases: { casesTotal: 10, casesPassed: 7, casesErrored: 1, rate: 0.7 },
        openBySeverity: [{ severity: 'high', count: 2 }],
        openByRuleClass: [{ ruleClass: 'prompt-injection', count: 2 }],
        history: [
          {
            runId: '019283af-0000-7000-8000-000000000001',
            skillId: 'alpha/declawed',
            repoId: 'alpha',
            outcome: 'passed',
            startedAt: '2026-08-03T10:00:00.000Z',
            endedAt: '2026-08-03T10:01:00.000Z',
            provenanceFp: 'abc123abc123',
          },
        ],
      }),
      80,
    )
    const text = rows.map((row) => row.text).join('\n')
    for (const expected of [
      'Stage pass rate',
      'validate',
      '75%',
      'Eval cases',
      '7/10',
      'Wall clock',
      '2.5s',
      'Open issues',
      'high',
      'prompt-injection',
      'Run history',
      'alpha/declawed',
    ]) {
      expect(text).toContain(expected)
    }
  })

  it('names the scope, so a filtered screen cannot be mistaken for the whole ledger', () => {
    const state = reducer(loaded({ ...emptyDashboard, runs: 1 }), {
      type: 'set-stats-filter',
      filter: { provenanceFp: 'abc123abc123' },
    })
    const rows = dashboardRows(
      reducer(state, { type: 'set-dashboard', stats: { ...emptyDashboard, runs: 1 } }),
      80,
    )
    expect(rows.map((row) => row.text).join('\n')).toContain('abc123abc123')
  })

  it('never emits a row wider than the width it was given', () => {
    const rows = dashboardRows(
      loaded({
        ...emptyDashboard,
        runs: 1,
        openByRuleClass: [{ ruleClass: 'x'.repeat(200), count: 1 }],
      }),
      40,
    )
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(40)
  })

  it('reports the read failure instead of an empty screen', () => {
    const state = reducer(initialState([], 2), {
      type: 'view-error',
      message: 'database is locked',
    })
    expect(dashboardRows(state, 80)[0]?.text).toContain('database is locked')
  })
})
