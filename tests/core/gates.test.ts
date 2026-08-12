import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { latestGateOutcomes } from '../../src/core/ledger/gates.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef, Stage, StageOutcome } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'repo/sk',
  name: 'sk',
  version: '1.0.0',
  dir: '/repo/sk',
  relPath: 'sk',
  repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
  rootSkill: false,
  frontmatterReadable: true,
  workspacePath: workspacePath('/repo', 'sk', false),
  deprecated: false,
  supersededBy: null,
}

const run = (
  ledger: ReturnType<typeof openLedger>,
  runId: string,
  digest: string,
  stages: ReadonlyArray<[Stage, StageOutcome]>,
): void => {
  recordRun(ledger, {
    skill,
    runId,
    trigger: 'test',
    startedAt: 'now',
    endedAt: 'now',
    outcome: 'passed',
    skillDigest: digest,
    git: { commit: null, dirty: false },
    provenanceJson: '{}',
    toolLockJson: '{}',
    sidecarPath: `/repo/sk-workspace/skillgantry/runs/${runId}`,
    stages: stages.map(([stage, outcome]) => ({
      stage,
      outcome,
      verdict: outcome === 'failed' ? 'failed' : 'passed',
      toolRuns: [],
    })),
  })
}

describe('latestGateOutcomes', () => {
  it('returns the most recent outcome per gate stage, by run id', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:old', [['validate', 'failed']])
    run(ledger, '019000000000-b', 'sha256:new', [['validate', 'passed'], ['security', 'passed']])
    const gates = latestGateOutcomes(ledger.db, skill.id)
    const byStage = new Map(gates.map((g) => [g.stage, g]))
    expect(byStage.get('validate')).toMatchObject({ outcome: 'passed', skillDigest: 'sha256:new' })
    expect(byStage.get('security')?.runId).toBe('019000000000-b')
    // A stage never run has no row, which is what release refuses on.
    expect(byStage.has('evaluate')).toBe(false)
  })

  it('skips a stage that reached no verdict, keeping the last one that did', () => {
    // Run 019fe59f passed all three gates; the user then re-ran evaluate and
    // cancelled it 22s in. Without this rule the cancellation superseded the
    // pass it never contradicted, and every release after refused
    // `gate-not-passed` against bytes a completed gate had already cleared.
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:x', [['evaluate', 'passed']])
    run(ledger, '019000000000-b', 'sha256:x', [['evaluate', 'errored']])
    run(ledger, '019000000000-c', 'sha256:x', [['evaluate', 'skipped']])
    expect(latestGateOutcomes(ledger.db, skill.id)).toMatchObject([
      { stage: 'evaluate', outcome: 'passed', runId: '019000000000-a' },
    ])
  })

  it('lets a degraded stage supersede, because some of its tools did reach a verdict', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:x', [['security', 'passed']])
    run(ledger, '019000000000-b', 'sha256:x', [['security', 'degraded']])
    expect(latestGateOutcomes(ledger.db, skill.id)).toMatchObject([
      { stage: 'security', outcome: 'degraded', runId: '019000000000-b' },
    ])
  })

  it('reports the stage missing when no run of it ever reached a verdict', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:x', [['validate', 'errored']])
    expect(latestGateOutcomes(ledger.db, skill.id)).toEqual([])
  })

  it('ignores optimise and release, which are not gates', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:x', [['release', 'passed']])
    expect(latestGateOutcomes(ledger.db, skill.id)).toEqual([])
  })
})
