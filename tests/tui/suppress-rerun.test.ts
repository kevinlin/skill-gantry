import { describe, expect, it } from 'vitest'
import { resumedGates } from '../../src/tui/rows.js'
import type { StageCell } from '../../src/tui/store.js'
import type { Stage } from '../../src/core/index.js'

const cell = (outcome: StageCell['outcome']): StageCell => ({
  outcome,
  running: false,
  summary: '',
  findings: 0,
})

/** `SkillRow.stages` is keyed by stage, not positional, so the fixture is too. */
const rail = (
  validate: StageCell['outcome'],
  evaluate: StageCell['outcome'],
  security: StageCell['outcome'],
): Record<Stage, StageCell> => ({
  validate: cell(validate),
  evaluate: cell(evaluate),
  security: cell(security),
  optimise: cell(null),
  release: cell(null),
})

describe('resumedGates', () => {
  // R5.1 halts on the first non-passed stage, so enqueueing the failed one
  // alone makes the user press r again.
  it('resumes from the first non-passing gate through security', () => {
    expect(resumedGates(rail('passed', 'passed', 'failed'))).toEqual(['security'])
    expect(resumedGates(rail('failed', null, null))).toEqual(['validate', 'evaluate', 'security'])
    expect(resumedGates(rail('passed', 'failed', null))).toEqual(['evaluate', 'security'])
  })

  it('treats a stage that never ran as non-passing', () => {
    expect(resumedGates(rail(null, null, null))).toEqual(['validate', 'evaluate', 'security'])
  })

  it('resolves to nothing when every gate passed', () => {
    expect(resumedGates(rail('passed', 'passed', 'passed'))).toEqual([])
  })

  it('treats a degraded or errored gate as non-passing', () => {
    expect(resumedGates(rail('passed', 'degraded', 'passed'))).toEqual(['evaluate', 'security'])
    expect(resumedGates(rail('errored', 'passed', 'passed'))).toEqual([
      'validate',
      'evaluate',
      'security',
    ])
  })
})
