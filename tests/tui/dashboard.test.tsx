import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef, type StatsFilter } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { emptyDashboard, fakeViews } from '../helpers/fake-views.js'
import { skillFixture } from '../helpers/ledger-fixture.js'
import { renderInk } from '../helpers/render-ink.js'

const SKILL = skillFixture('alpha', 'declawed') as SkillRef
const OPTIONS = [
  {
    fingerprint: 'aaaaaaaaaaaa',
    baseUrlHost: 'api.deepseek.com',
    model: 'm',
    analysisModes: 'skillspector:static',
    runs: 3,
    firstSeen: '2026-08-01T00:00:00.000Z',
    lastSeen: '2026-08-03T00:00:00.000Z',
  },
]

const STATS = {
  ...emptyDashboard,
  repos: 2,
  skills: 3,
  runs: 4,
  stagePassRates: [{ stage: 'validate' as const, runs: 4, passed: 3, rate: 0.75 }],
  wallClock: [{ stage: 'validate' as const, runs: 4, medianMs: 2_500, maxMs: 9_000 }],
  evalCases: { casesTotal: 10, casesPassed: 7, casesErrored: 0, rate: 0.7 },
  openBySeverity: [{ severity: 'high' as const, count: 2 }],
  openByRuleClass: [{ ruleClass: 'prompt-injection', count: 2 }],
  history: [],
}

async function onDashboard(size = { columns: 100, rows: 30 }) {
  const asked: StatsFilter[] = []
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews({
    dashboard: async (filter) => {
      asked.push(filter)
      // A narrowed filter must visibly change the answer, or the assertion
      // below would pass on a screen that ignored the key.
      return filter.provenanceFp === undefined && filter.skillId === undefined
        ? STATS
        : { ...STATS, repos: 1, skills: 1, runs: 1 }
    },
    provenances: async () => OPTIONS,
  })
  const ui = renderInk(
    <App
      skills={[SKILL]}
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
  for (const char of 'dashboard') ui.stdin.send(char)
  ui.stdin.send('\r')
  await ui.settle(60)
  return { ui, asked }
}

describe('Dashboard screen — R8.9, R7.6', () => {
  it('renders every R8.9 section', async () => {
    const { ui } = await onDashboard()
    const frame = ui.lastFrame()
    for (const section of [
      'Stage pass rate',
      'Eval cases',
      'Wall clock',
      'Open issues',
      'Run history',
    ]) {
      expect(frame).toContain(section)
    }
    ui.unmount()
  })

  it('p applies a provenance filter and p again removes it', async () => {
    const { ui, asked } = await onDashboard()
    ui.stdin.send('p')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({ provenanceFp: 'aaaaaaaaaaaa' })
    expect(ui.lastFrame()).toContain('1 repos')
    ui.stdin.send('p')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({})
    expect(ui.lastFrame()).toContain('2 repos')
    ui.unmount()
  })

  it('s narrows to the selected skill and back', async () => {
    const { ui, asked } = await onDashboard()
    ui.stdin.send('s')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({ skillId: 'alpha/declawed' })
    ui.stdin.send('s')
    await ui.settle(60)
    expect(asked.at(-1)).toEqual({})
    ui.unmount()
  })

  it('fits an 80x24 and a 50x14 terminal', async () => {
    for (const size of [
      { columns: 80, rows: 24 },
      { columns: 50, rows: 14 },
    ]) {
      const { ui } = await onDashboard(size)
      expect(ui.lastFrame().split('\n').length).toBeLessThanOrEqual(size.rows)
      ui.unmount()
    }
  })
})
