import { describe, expect, it } from 'vitest'
import type { RawFinding, SkillRef, ToolRunRecord } from '../../src/core/index.js'
import { initialState, reducer } from '../../src/tui/store.js'

const skill: SkillRef = {
  id: 'declawed',
  name: 'declawed',
  version: '1.0.0',
  dir: '/repo/declawed',
  relPath: 'declawed',
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: '/repo/declawed-workspace',
  deprecated: false,
  supersededBy: null,
}

const finding: RawFinding = {
  ruleClass: 'unsafe-script',
  nativeRuleId: 'SG101',
  severity: 'low',
  path: 'declawed/scripts/scan.py',
  message: 'shell=True on an interpolated path',
}

const toolRun = (over: Partial<ToolRunRecord> = {}): ToolRunRecord => ({
  toolId: 'skill-lint',
  toolVersion: '1.0.0',
  outcome: 'passed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/repo/declawed-workspace/skillgantry/runs/r1/01-validate/skill-lint',
  findings: [finding],
  metrics: {},
  summary: '1 finding',
  ...over,
})

describe('R11.14 finding attribution', () => {
  it('records the stage, the tool and the artefact directory from tool:done', () => {
    let state = initialState([skill], 2)
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: {
          type: 'run:start',
          runId: 'r1',
          skillId: 'declawed',
          stages: ['validate'],
          runDir: '/runs/r1',
        },
      },
    })
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: {
          type: 'tool:done',
          runId: 'r1',
          stage: 'validate',
          toolId: 'skill-lint',
          result: toolRun(),
        },
      },
    })

    const rows = state.skills[0]?.findings ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.stage).toBe('validate')
    expect(rows[0]?.toolId).toBe('skill-lint')
    expect(rows[0]?.artefactDir).toBe(
      '/repo/declawed-workspace/skillgantry/runs/r1/01-validate/skill-lint',
    )
    expect(rows[0]?.finding.ruleClass).toBe('unsafe-script')
  })

  it('attributes two tools in one stage to themselves, not to the stage', () => {
    let state = initialState([skill], 2)
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: {
          type: 'run:start',
          runId: 'r1',
          skillId: 'declawed',
          stages: ['security'],
          runDir: '/runs/r1',
        },
      },
    })
    for (const toolId of ['skill-scanner', 'skillspector']) {
      state = reducer(state, {
        type: 'queue-event',
        event: {
          type: 'run:event',
          jobId: 'j1',
          event: {
            type: 'tool:done',
            runId: 'r1',
            stage: 'security',
            toolId,
            result: toolRun({ toolId, artefactDir: `/runs/r1/03-security/${toolId}` }),
          },
        },
      })
    }
    const rows = state.skills[0]?.findings ?? []
    expect(rows.map((row) => row.toolId)).toEqual(['skill-scanner', 'skillspector'])
    expect(rows.map((row) => row.artefactDir)).toEqual([
      '/runs/r1/03-security/skill-scanner',
      '/runs/r1/03-security/skillspector',
    ])
  })
})
