import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import { recordRun } from '../../src/core/ledger/record.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'zapac/architecture-diagram',
  name: 'architecture-diagram',
  version: null,
  dir: '/tmp/zapac/architecture-diagram',
  relPath: 'architecture-diagram',
  repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
  rootSkill: false,
  workspacePath: '/tmp/zapac/architecture-diagram-workspace',
}

const PATH = 'architecture-diagram/scripts/html_to_png.py'

const finding = (nativeRuleId: string): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId,
  severity: 'medium',
  path: PATH,
  message: nativeRuleId,
})

const toolRun = (toolId: string, findings: RawFinding[]): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome: findings.length === 0 ? 'passed' : 'failed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: `/tmp/ws/${toolId}`,
  findings,
  metrics: {},
  summary: '',
})

const stage = (name: 'validate' | 'security', toolRuns: ToolRunRecord[]): StageResult => ({
  stage: name,
  outcome: 'failed',
  verdict: 'failed',
  toolRuns,
})

const input = (runId: string, stages: StageResult[]) => ({
  skill,
  runId,
  trigger: 'test',
  startedAt: '2026-08-02T00:00:00Z',
  endedAt: '2026-08-02T00:01:00Z',
  outcome: 'failed' as const,
  skillDigest: 'sha256:x',
  git: { commit: null, dirty: false },
  provenanceJson: '{}',
  toolLockJson: '{}',
  sidecarPath: '/tmp/ws',
  stages,
})

describe('occurrence_count across a run', () => {
  it('sums every tool run rather than keeping whichever finished last', () => {
    const ledger = openLedger(':memory:')
    recordRun(
      ledger,
      input('run-1', [
        // skillspector reports AST4 twice on one file; skill-lint reports R06
        // once on the same file. Both are unsafe-script, so one issue.
        stage('security', [toolRun('skillspector', [finding('AST4'), finding('AST4')])]),
        stage('validate', [toolRun('skill-lint', [finding('R06')])]),
      ]),
    )

    const fp = fingerprint(skill.id, PATH, 'unsafe-script')
    const row = ledger.db
      .prepare('select occurrence_count from issues where fingerprint = ?')
      .get(fp) as { occurrence_count: number }
    expect(row.occurrence_count).toBe(3)
  })

  it('resets rather than accumulates across runs', () => {
    const ledger = openLedger(':memory:')
    recordRun(ledger, input('run-1', [stage('security', [toolRun('skillspector', [finding('AST4'), finding('AST4')])])]))
    recordRun(ledger, input('run-2', [stage('security', [toolRun('skillspector', [finding('AST4')])])]))

    const fp = fingerprint(skill.id, PATH, 'unsafe-script')
    const row = ledger.db
      .prepare('select occurrence_count from issues where fingerprint = ?')
      .get(fp) as { occurrence_count: number }
    // "how many times was this seen last time we looked", not a running total.
    expect(row.occurrence_count).toBe(1)
  })
})
