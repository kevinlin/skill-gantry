import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parse as parseSkillLint } from '../../src/core/adapters/skill-lint.js'
import { parse as parseSkillspector } from '../../src/core/adapters/skillspector.js'
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
  deprecated: false,
  supersededBy: null,
}

const MERGED = 'architecture-diagram/scripts/html_to_png.py'
const LINT_ONLY = 'architecture-diagram/scripts/build_gallery.py'

async function realFindings(): Promise<{ spector: RawFinding[]; lint: RawFinding[] }> {
  const sarif = await readFile('tests/fixtures/sarif/skillspector-architecture-diagram.sarif')
  const json = await readFile('tests/fixtures/skill-lint/architecture-diagram.json', 'utf8')
  const base = { skill, stderr: '', durationMs: 10 }
  const spector = parseSkillspector({
    ...base,
    artefacts: new Map([['findings.sarif', sarif]]),
    stdout: '',
    exitCode: 0,
  })
  const lint = parseSkillLint({ ...base, artefacts: new Map(), stdout: json, exitCode: 0 })
  return { spector: spector.findings, lint: lint.findings }
}

const toolRun = (toolId: string, findings: RawFinding[], outcome: ToolRunRecord['outcome'] = 'failed'): ToolRunRecord => ({
  toolId,
  toolVersion: '1.0.0',
  outcome,
  exitCode: 0,
  durationMs: 10,
  errorKind: outcome === 'errored' ? 'timeout' : null,
  artefactDir: `/tmp/ws/${toolId}`,
  findings,
  metrics: {},
  summary: '',
})

// skill-lint's findings here are LOW only, so §8.1 row 12b passes its tool run
// while keeping the findings. Recording it as `passed` is what the executor
// would actually produce, and it proves a sub-floor advisory still merges across
// tools and still closes — reconciliation is keyed on `passed | failed` alike.
const stages = (spector: RawFinding[], lint: RawFinding[]): StageResult[] => [
  { stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [toolRun('skill-lint', lint, 'passed')] },
  { stage: 'security', outcome: 'failed', verdict: 'failed', toolRuns: [toolRun('skillspector', spector)] },
]

const runInput = (runId: string, s: StageResult[]) => ({
  skill, runId, trigger: 'test',
  startedAt: '2026-08-02T00:00:00Z', endedAt: '2026-08-02T00:01:00Z',
  outcome: 'failed' as const, skillDigest: 'sha256:x', git: { commit: null, dirty: false },
  provenanceJson: '{}', toolLockJson: '{}', sidecarPath: '/tmp/ws', stages: s,
})

describe('cross-tool merge over real fixtures', () => {
  it('resolves one problem seen by two tools to one issue with two detectors — R8.6', async () => {
    const { spector, lint } = await realFindings()
    const ledger = openLedger(':memory:')
    recordRun(ledger, runInput('run-1', stages(spector, lint)))

    const fp = fingerprint(skill.id, MERGED, 'unsafe-script')
    const detections = ledger.db
      .prepare('select count(*) as n from issue_detections where issue_fp = ?')
      .get(fp) as { n: number }
    const detectors = ledger.db
      .prepare('select tool_id from issue_detectors where issue_fp = ? order by tool_id')
      .all(fp) as Array<{ tool_id: string }>

    // skillspector AST4 twice plus skill-lint R06 once — R8.13, one row per
    // occurrence even though all three collapse to one issue.
    expect(detections.n).toBe(3)
    expect(detectors.map((d) => d.tool_id)).toEqual(['skill-lint', 'skillspector'])

    const issues = ledger.db
      .prepare('select count(*) as n from issues where skill_id = ?')
      .get(skill.id) as { n: number }
    expect(issues.n).toBe(4)
  })

  it('holds the merged issue open while one detector is inconclusive — R8.8', async () => {
    const { spector, lint } = await realFindings()
    const ledger = openLedger(':memory:')
    recordRun(ledger, runInput('run-1', stages(spector, lint)))

    // Run 2: skill-lint finds nothing, skillspector errored. The errored tool
    // contributes nothing, so the issue must survive.
    recordRun(ledger, runInput('run-2', [
      { stage: 'validate', outcome: 'passed', verdict: 'passed', toolRuns: [toolRun('skill-lint', [], 'passed')] },
      { stage: 'security', outcome: 'errored', verdict: 'passed', toolRuns: [toolRun('skillspector', [], 'errored')] },
    ]))

    const fp = fingerprint(skill.id, MERGED, 'unsafe-script')
    expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp))
      .toEqual({ state: 'open' })

    // The single-detector issue has no such constraint and closes in run 2.
    const lintOnly = fingerprint(skill.id, LINT_ONLY, 'unsafe-script')
    expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(lintOnly))
      .toEqual({ state: 'fixed' })
  })

  it('closes the merged issue once both detectors have run clean, in either order', async () => {
    for (const order of [['skill-lint', 'skillspector'], ['skillspector', 'skill-lint']]) {
      const { spector, lint } = await realFindings()
      const ledger = openLedger(':memory:')
      recordRun(ledger, runInput('run-1', stages(spector, lint)))

      // One tool clears in run 2, the other in run 3 — closure is a conjunction
      // over a set, so the order must not change the outcome.
      const clear = (tool: string): StageResult[] => [
        { stage: tool === 'skill-lint' ? 'validate' : 'security', outcome: 'passed', verdict: 'passed',
          toolRuns: [toolRun(tool, [], 'passed')] },
      ]
      recordRun(ledger, runInput('run-2', clear(order[0] as string)))
      const fp = fingerprint(skill.id, MERGED, 'unsafe-script')
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp))
        .toEqual({ state: 'open' })

      recordRun(ledger, runInput('run-3', clear(order[1] as string)))
      expect(ledger.db.prepare('select state from issues where fingerprint = ?').get(fp))
        .toEqual({ state: 'fixed' })
    }
  })
})
