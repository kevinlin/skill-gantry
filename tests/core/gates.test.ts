import { describe, expect, it } from 'vitest'
import { openLedger } from '../../src/core/ledger/db.js'
import { latestGateOutcomes } from '../../src/core/ledger/gates.js'
import { recordRun } from '../../src/core/ledger/record.js'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef, Stage } from '../../src/core/types.js'

const skill: SkillRef = {
  id: 'repo/sk',
  name: 'sk',
  version: '1.0.0',
  dir: '/repo/sk',
  relPath: 'sk',
  repo: { id: 'repo', path: '/repo', name: 'repo', isGit: false },
  rootSkill: false,
  workspacePath: workspacePath('/repo', 'sk', false),
  deprecated: false,
  supersededBy: null,
}

const run = (
  ledger: ReturnType<typeof openLedger>,
  runId: string,
  digest: string,
  stages: ReadonlyArray<[Stage, 'passed' | 'failed']>,
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
    stages: stages.map(([stage, outcome]) => ({ stage, outcome, verdict: outcome, toolRuns: [] })),
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

  it('ignores optimise and release, which are not gates', () => {
    const ledger = openLedger(':memory:')
    run(ledger, '019000000000-a', 'sha256:x', [['release', 'passed']])
    expect(latestGateOutcomes(ledger.db, skill.id)).toEqual([])
  })
})
