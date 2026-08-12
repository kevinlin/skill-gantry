import { describe, expect, it } from 'vitest'
import { provenanceFingerprint } from '../../src/core/ledger/fingerprint.js'
import { dashboard, openIssueCounts, provenanceOptions } from '../../src/core/ledger/stats.js'
import { memoryLedger, recordFixtureRun, skillFixture } from '../helpers/ledger-fixture.js'

const ALPHA = skillFixture('alpha', 'declawed')
const BETA = skillFixture('beta', 'spec-lint')
const P1 = { baseUrlHost: 'api.deepseek.com', models: {}, authTokenHash: null, analysisModes: {} }
const P2 = { baseUrlHost: 'api.anthropic.com', models: {}, authTokenHash: null, analysisModes: {} }

const finding = (path: string, ruleClass: string, severity: 'high' | 'low') => ({
  ruleClass: ruleClass as never,
  nativeRuleId: 'X1',
  severity,
  path,
  message: 'm',
})

function seeded() {
  const ledger = memoryLedger()
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000001',
    skill: ALPHA,
    provenance: P1,
    stages: [
      { stage: 'validate', outcome: 'passed', seconds: 2 },
      {
        stage: 'evaluate',
        outcome: 'passed',
        seconds: 10,
        metrics: { casesTotal: 6, casesPassed: 5, casesErrored: 0 },
      },
      {
        stage: 'security',
        outcome: 'failed',
        seconds: 4,
        findings: [finding('declawed/SKILL.md', 'prompt-injection', 'high')],
      },
    ],
  })
  recordFixtureRun(ledger, {
    runId: '019283af-0000-7000-8000-000000000002',
    skill: BETA,
    provenance: P2,
    stages: [
      { stage: 'validate', outcome: 'failed', seconds: 6 },
      {
        stage: 'evaluate',
        outcome: 'passed',
        seconds: 20,
        metrics: { casesTotal: 4, casesPassed: 2, casesErrored: 1 },
      },
    ],
  })
  return ledger
}

describe('dashboard — R8.9 across every registered repo', () => {
  it('counts repos, skills and runs across both repos', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats).toMatchObject({ repos: 2, skills: 2, runs: 2 })
  })

  it('reports stage pass rate per stage', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.stagePassRates).toEqual(
      expect.arrayContaining([
        { stage: 'validate', runs: 2, passed: 1, rate: 0.5 },
        { stage: 'evaluate', runs: 2, passed: 2, rate: 1 },
        { stage: 'security', runs: 1, passed: 0, rate: 0 },
      ]),
    )
  })

  it('reports eval case pass rate from the stage metrics', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.evalCases).toEqual({
      casesTotal: 10,
      casesPassed: 7,
      casesErrored: 1,
      rate: 0.7,
    })
  })

  it('reports wall clock per stage from the stages own span', () => {
    const stats = dashboard(seeded().db, {})
    const evaluate = stats.wallClock.find((row) => row.stage === 'evaluate')
    expect(evaluate).toEqual({ stage: 'evaluate', runs: 2, medianMs: 15_000, maxMs: 20_000 })
  })

  it('counts open issues by severity and by rule class', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.openBySeverity).toEqual([{ severity: 'high', count: 1 }])
    expect(stats.openByRuleClass).toEqual([{ ruleClass: 'prompt-injection', count: 1 }])
  })

  it('lists run history newest first', () => {
    const stats = dashboard(seeded().db, {})
    expect(stats.history.map((row) => row.skillId)).toEqual(['beta/spec-lint', 'alpha/declawed'])
  })

  // R6.1: the row names a run, and the name is the directory the run recorded.
  // Ordering stays on the id, which is why this asserts both at once.
  it('names each run by its directory while ordering on the identity', () => {
    const ledger = memoryLedger()
    for (const [runId, dir] of [
      ['019283af-0000-7000-8000-00000000000a', '2026-08-03_10-00-00'],
      ['019283af-0000-7000-8000-00000000000b', '2026-08-03_10-00-00-2'],
    ] as const) {
      recordFixtureRun(ledger, {
        runId,
        skill: ALPHA,
        sidecarPath: `/tmp/declawed-workspace/skillgantry/runs/${dir}`,
        stages: [{ stage: 'validate', outcome: 'passed' }],
      })
    }
    // Two runs claimed in the same second, so the directory names tie and only
    // the id can order them.
    expect(dashboard(ledger.db, {}).history.map((row) => row.runDir)).toEqual([
      '2026-08-03_10-00-00-2',
      '2026-08-03_10-00-00',
    ])
  })

  it('narrows to one skill', () => {
    const stats = dashboard(seeded().db, { skillId: 'alpha/declawed' })
    expect(stats.runs).toBe(1)
    expect(stats.evalCases.casesTotal).toBe(6)
  })

  it('narrows to one repo', () => {
    const stats = dashboard(seeded().db, { repoId: 'beta' })
    expect(stats.runs).toBe(1)
    expect(stats.stagePassRates.find((row) => row.stage === 'validate')?.passed).toBe(0)
  })
})

describe('provenance grouping — R7.6', () => {
  it('lists one option per distinct fingerprint with its run count', () => {
    const options = provenanceOptions(seeded().db)
    expect(options).toHaveLength(2)
    expect(options.map((option) => option.baseUrlHost).sort()).toEqual([
      'api.anthropic.com',
      'api.deepseek.com',
    ])
    expect(options.every((option) => option.runs === 1)).toBe(true)
  })

  it('filters every statistic by fingerprint', () => {
    const stats = dashboard(seeded().db, { provenanceFp: provenanceFingerprint(P1) })
    expect(stats.runs).toBe(1)
    expect(stats.evalCases.casesTotal).toBe(6)
    // The issue's last_seen_run belongs to the P1 run, so it survives the filter.
    expect(stats.openBySeverity).toEqual([{ severity: 'high', count: 1 }])
  })

  it('excludes an issue whose last sighting was under another provenance', () => {
    const stats = dashboard(seeded().db, { provenanceFp: provenanceFingerprint(P2) })
    expect(stats.openBySeverity).toEqual([])
  })
})

describe('openIssueCounts — suppression (R8.15)', () => {
  it('excludes a suppressed issue from the counts and reports it separately', () => {
    const ledger = memoryLedger()
    const skill = skillFixture('alpha', 'declawed')
    const raw = {
      ruleClass: 'prompt-injection' as never,
      nativeRuleId: 'AS3',
      severity: 'high' as const,
      path: 'declawed/SKILL.md',
      message: 'x',
    }
    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-0000000000a1',
      skill,
      stages: [{ stage: 'security', outcome: 'failed', findings: [raw] }],
    })
    expect(openIssueCounts(ledger.db, {})).toMatchObject({
      bySeverity: [{ severity: 'high', count: 1 }],
      suppressed: 0,
    })

    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-0000000000a2',
      skill,
      stages: [
        {
          stage: 'security',
          outcome: 'passed',
          findings: [{ ...raw, suppressed: { justification: 'baselined' } }],
        },
      ],
    })
    // Still open — a suppression is not a closure — but out of the count.
    expect(openIssueCounts(ledger.db, {})).toMatchObject({
      bySeverity: [],
      byRuleClass: [],
      suppressed: 1,
    })

    recordFixtureRun(ledger, {
      runId: '019283af-0000-7000-8000-0000000000a3',
      skill,
      stages: [{ stage: 'security', outcome: 'failed', findings: [raw] }],
    })
    expect(openIssueCounts(ledger.db, {})).toMatchObject({
      bySeverity: [{ severity: 'high', count: 1 }],
      suppressed: 0,
    })
  })
})
