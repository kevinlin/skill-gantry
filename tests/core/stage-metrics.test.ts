import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { reduceStageMetrics } from '../../src/core/stages/outcome.js'
import type { ToolRunRecord } from '../../src/core/stages/types.js'
import { skillFixture } from '../helpers/ledger-fixture.js'

const toolRun = (toolId: string, metrics: ToolRunRecord['metrics']): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome: 'passed',
  exitCode: 0,
  durationMs: 1_000,
  errorKind: null,
  artefactDir: `/tmp/${toolId}`,
  findings: [],
  metrics,
  summary: '',
})

describe('reduceStageMetrics', () => {
  it('sums count-like metrics across the stages tool runs', () => {
    const metrics = reduceStageMetrics([
      toolRun('skill-up', { casesTotal: 6, casesPassed: 4, casesErrored: 1 }),
      toolRun('other', { casesTotal: 2, casesPassed: 2 }),
    ])
    expect(metrics).toEqual({ casesTotal: 8, casesPassed: 6, casesErrored: 1 })
  })

  it('drops durationMs, because concurrent fan-out tools do not add up to a stage', () => {
    const metrics = reduceStageMetrics([
      toolRun('a', { durationMs: 5_000, findingsTotal: 1 }),
      toolRun('b', { durationMs: 4_000, findingsTotal: 2 }),
    ])
    expect(metrics).toEqual({ findingsTotal: 3 })
  })
})

describe('recordRun stage columns', () => {
  it('writes the stages own span and metrics, not the runs', () => {
    const ledger = openLedger(':memory:')
    recordRun(ledger, {
      skill: skillFixture('repo', 'sk'),
      runId: '019283af-0000-7000-8000-000000000001',
      trigger: 'test',
      startedAt: '2026-08-03T10:00:00.000Z',
      endedAt: '2026-08-03T10:00:30.000Z',
      outcome: 'passed',
      skillDigest: 'sha256:abc',
      git: { commit: null, dirty: false },
      provenanceJson: '{}',
      toolLockJson: '{}',
      sidecarPath: '/tmp/run',
      stages: [
        {
          stage: 'evaluate',
          outcome: 'passed',
          verdict: 'passed',
          startedAt: '2026-08-03T10:00:05.000Z',
          endedAt: '2026-08-03T10:00:11.000Z',
          metrics: { casesTotal: 4, casesPassed: 4 },
          toolRuns: [],
        },
      ],
    })

    const row = ledger.db
      .prepare('select started_at, ended_at, metrics_json from stages')
      .get() as { started_at: string; ended_at: string; metrics_json: string }
    expect(row.started_at).toBe('2026-08-03T10:00:05.000Z')
    expect(row.ended_at).toBe('2026-08-03T10:00:11.000Z')
    expect(JSON.parse(row.metrics_json)).toEqual({ casesTotal: 4, casesPassed: 4 })
    ledger.close()
  })

  it('leaves both columns null when the stage carried no span', () => {
    const ledger = openLedger(':memory:')
    recordRun(ledger, {
      skill: skillFixture('repo', 'sk'),
      runId: '019283af-0000-7000-8000-000000000002',
      trigger: 'test',
      startedAt: 'now',
      endedAt: 'now',
      outcome: 'passed',
      skillDigest: 'sha256:abc',
      git: { commit: null, dirty: false },
      provenanceJson: '{}',
      toolLockJson: '{}',
      sidecarPath: '/tmp/run',
      stages: [{ stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [] }],
    })
    const row = ledger.db.prepare('select started_at, ended_at from stages').get() as {
      started_at: string | null
      ended_at: string | null
    }
    expect(row.started_at).toBeNull()
    expect(row.ended_at).toBeNull()
    ledger.close()
  })
})
