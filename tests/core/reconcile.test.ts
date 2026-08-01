import { beforeEach, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '../../src/core/ledger/db.js'
import { fingerprint } from '../../src/core/ledger/fingerprint.js'
import { recordRun, type RunRecordInput } from '../../src/core/ledger/record.js'
import type { StageResult, ToolRunRecord } from '../../src/core/stages/types.js'
import type { RawFinding, SkillRef, ToolOutcome } from '../../src/core/types.js'

const SKILL = {
  id: 'fx/declawed',
  name: 'declawed',
  version: '1.1.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  rootSkill: false,
  workspacePath: '/repo/declawed-workspace',
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
} as SkillRef

const finding = (over: Partial<RawFinding> = {}): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId: 'LP3',
  severity: 'medium',
  path: 'declawed/scripts/scan.py',
  line: 34,
  message: 'unsafe script',
  ...over,
})

const toolRun = (over: Partial<ToolRunRecord> = {}): ToolRunRecord => ({
  toolId: 'skillspector',
  toolVersion: '2.5.1',
  outcome: 'failed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/w/skillspector',
  findings: [finding()],
  metrics: {},
  summary: '1 finding',
  ...over,
})

const stage = (toolRuns: ToolRunRecord[], outcome: StageResult['outcome']): StageResult => ({
  stage: 'security',
  outcome,
  verdict: toolRuns.some((t) => t.outcome === 'failed') ? 'failed' : 'passed',
  toolRuns,
})

let seq = 0
const input = (stages: StageResult[]): RunRecordInput => ({
  skill: SKILL,
  runId: `run-${++seq}`,
  trigger: 'cli',
  startedAt: '2026-08-01T00:00:00Z',
  endedAt: '2026-08-01T00:00:10Z',
  outcome: stages[0]?.outcome ?? 'passed',
  skillDigest: 'sha256:abc',
  git: { commit: null, dirty: false },
  provenanceJson: '{}',
  toolLockJson: '{}',
  sidecarPath: '/w',
  stages,
})

const FP = fingerprint(SKILL.id, 'declawed/scripts/scan.py', 'unsafe-script')

const stateOf = (ledger: Ledger, fp = FP): string | undefined =>
  (
    ledger.db.prepare('select state from issues where fingerprint = ?').get(fp) as
      | { state: string }
      | undefined
  )?.state

const detectionCount = (ledger: Ledger, fp = FP): number =>
  (
    ledger.db.prepare('select count(*) as n from issue_detections where issue_fp = ?').get(fp) as {
      n: number
    }
  ).n

let ledger: Ledger

beforeEach(() => {
  ledger = openLedger(':memory:')
  seq = 0
})

describe('recordRun', () => {
  it('opens an issue on first detection', () => {
    const delta = recordRun(ledger, input([stage([toolRun()], 'failed')]))
    expect(delta.opened).toBe(1)
    expect(stateOf(ledger)).toBe('open')
  })

  it('merges two tools reporting the same class and file into one issue', () => {
    const other = toolRun({ toolId: 'skill-scanner', findings: [finding({ nativeRuleId: 'C14' })] })
    recordRun(ledger, input([stage([toolRun(), other], 'failed')]))
    expect((ledger.db.prepare('select count(*) as n from issues').get() as { n: number }).n).toBe(1)
    expect(detectionCount(ledger)).toBe(2)
  })

  it('gives each occurrence from one tool its own ordinal', () => {
    const run = toolRun({ findings: [finding({ line: 10 }), finding({ line: 99 })] })
    recordRun(ledger, input([stage([run], 'failed')]))
    expect(detectionCount(ledger)).toBe(2)
    const ordinals = ledger.db
      .prepare('select ordinal from issue_detections where issue_fp = ? order by ordinal')
      .all(FP)
      .map((r) => (r as { ordinal: number }).ordinal)
    expect(ordinals).toEqual([0, 1])
  })

  it('records the occurrence count on the issue', () => {
    const run = toolRun({ findings: [finding({ line: 10 }), finding({ line: 99 })] })
    recordRun(ledger, input([stage([run], 'failed')]))
    const row = ledger.db
      .prepare('select occurrence_count as n from issues where fingerprint = ?')
      .get(FP) as { n: number }
    expect(row.n).toBe(2)
  })

  it('keeps the strongest severity seen', () => {
    recordRun(
      ledger,
      input([stage([toolRun({ findings: [finding({ severity: 'low' })] })], 'failed')]),
    )
    recordRun(
      ledger,
      input([stage([toolRun({ findings: [finding({ severity: 'critical' })] })], 'failed')]),
    )
    const row = ledger.db
      .prepare('select severity_max from issues where fingerprint = ?')
      .get(FP) as { severity_max: string }
    expect(row.severity_max).toBe('critical')
  })
})

const clean = (outcome: ToolOutcome = 'passed'): StageResult =>
  stage([toolRun({ outcome, findings: [] })], outcome === 'passed' ? 'passed' : 'errored')

describe('reconciliation', () => {
  it('closes an issue the same tool no longer reports', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    const delta = recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger)).toBe('fixed')
    expect(delta.closed).toBe(1)
  })

  it('closes nothing when the tool errored', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    const delta = recordRun(ledger, input([clean('errored')]))
    expect(stateOf(ledger)).toBe('open')
    expect(delta.closed).toBe(0)
  })

  it('closes nothing when the tool was skipped', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    recordRun(ledger, input([stage([toolRun({ outcome: 'skipped', findings: [] })], 'skipped')]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('closes an acknowledged issue', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    ledger.db.prepare(`update issues set state = 'acknowledged' where fingerprint = ?`).run(FP)
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger)).toBe('fixed')
  })

  it('never closes a wontfix issue', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    ledger.db.prepare(`update issues set state = 'wontfix' where fingerprint = ?`).run(FP)
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger)).toBe('wontfix')
  })

  it('reopens a fixed issue that comes back', () => {
    recordRun(ledger, input([stage([toolRun()], 'failed')]))
    recordRun(ledger, input([clean('passed')]))
    const delta = recordRun(ledger, input([stage([toolRun()], 'failed')]))
    expect(stateOf(ledger)).toBe('open')
    expect(delta.reopened).toBe(1)
  })

  it('closes an unmapped issue for the tool that raised it', () => {
    const unmapped = finding({ ruleClass: 'unmapped:skillspector:ZZ9', nativeRuleId: 'ZZ9' })
    const fp = fingerprint(SKILL.id, unmapped.path, unmapped.ruleClass)
    recordRun(ledger, input([stage([toolRun({ findings: [unmapped] })], 'failed')]))
    expect(stateOf(ledger, fp)).toBe('open')
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger, fp)).toBe('fixed')
  })

  it('does not let one tool close another tool unmapped issue', () => {
    const unmapped = finding({ ruleClass: 'unmapped:skill-scanner:ZZ9', nativeRuleId: 'ZZ9' })
    const fp = fingerprint(SKILL.id, unmapped.path, unmapped.ruleClass)
    recordRun(
      ledger,
      input([stage([toolRun({ toolId: 'skill-scanner', findings: [unmapped] })], 'failed')]),
    )
    recordRun(ledger, input([clean('passed')])) // skillspector runs clean
    expect(stateOf(ledger, fp)).toBe('open')
  })

  it('does not let a tool close an issue outside its detects list', () => {
    const evalFinding = finding({ ruleClass: 'eval-failure', nativeRuleId: 'E1' })
    const fp = fingerprint(SKILL.id, evalFinding.path, 'eval-failure')
    recordRun(
      ledger,
      input([stage([toolRun({ toolId: 'skill-up', findings: [evalFinding] })], 'failed')]),
    )
    recordRun(ledger, input([clean('passed')])) // skillspector cannot detect eval-failure
    expect(stateOf(ledger, fp)).toBe('open')
  })
})

/**
 * Detector ownership. One issue, two scanners, and closure must not depend on
 * which of them finished first — which is exactly what revision 2's
 * most-recent-detector rule could not promise.
 */
describe('conjunctive closure across detectors', () => {
  const both = (findings: RawFinding[]): StageResult =>
    stage(
      [
        toolRun({
          toolId: 'skillspector',
          findings,
          outcome: findings.length ? 'failed' : 'passed',
        }),
        toolRun({
          toolId: 'skill-scanner',
          findings,
          outcome: findings.length ? 'failed' : 'passed',
        }),
      ],
      findings.length ? 'failed' : 'passed',
    )

  const mixed = (present: string, absentOutcome: ToolOutcome): StageResult =>
    stage(
      [
        toolRun({ toolId: present, findings: [], outcome: 'passed' }),
        toolRun({
          toolId: present === 'skillspector' ? 'skill-scanner' : 'skillspector',
          findings: [],
          outcome: absentOutcome,
        }),
      ],
      'degraded',
    )

  beforeEach(() => {
    recordRun(ledger, input([both([finding()])]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('stays open when one detector is absent and the other errored', () => {
    recordRun(ledger, input([mixed('skillspector', 'errored')]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('stays open when one detector is absent and the other was skipped', () => {
    recordRun(ledger, input([mixed('skillspector', 'skipped')]))
    expect(stateOf(ledger)).toBe('open')
  })

  it('closes only once both detectors are conclusively absent', () => {
    recordRun(ledger, input([mixed('skillspector', 'errored')]))
    expect(stateOf(ledger)).toBe('open')
    const delta = recordRun(ledger, input([both([])]))
    expect(stateOf(ledger)).toBe('fixed')
    expect(delta.closed).toBe(1)
  })

  it('reaches the same state whichever detector clears first', () => {
    const other = openLedger(':memory:')
    seq = 0
    recordRun(other, input([both([finding()])]))

    seq = 1
    recordRun(ledger, input([mixed('skillspector', 'errored')]))
    recordRun(ledger, input([both([])]))

    seq = 1
    recordRun(other, input([mixed('skill-scanner', 'errored')]))
    recordRun(other, input([both([])]))

    expect(stateOf(ledger)).toBe(stateOf(other))
    other.close()
  })

  it('widens scope to a class the manifest never declared', () => {
    // skillspector does not declare eval-failure, but if it produced one it
    // must be able to retract it.
    const stray = finding({ ruleClass: 'eval-failure', nativeRuleId: 'E1' })
    const fp = fingerprint(SKILL.id, stray.path, 'eval-failure')
    recordRun(ledger, input([stage([toolRun({ findings: [stray] })], 'failed')]))
    expect(stateOf(ledger, fp)).toBe('open')
    recordRun(ledger, input([clean('passed')]))
    expect(stateOf(ledger, fp)).toBe('fixed')
  })
})
