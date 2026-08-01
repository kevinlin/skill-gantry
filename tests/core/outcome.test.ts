import { describe, expect, it } from 'vitest'
import { TOOL_OUTCOMES, haltsChain, reduceStageOutcome } from '../../src/core/stages/outcome.js'
import type { StageOutcome, ToolOutcome } from '../../src/core/types.js'

const VALID_STAGE: ReadonlySet<StageOutcome> = new Set([
  'passed',
  'failed',
  'degraded',
  'errored',
  'skipped',
])

/** All non-empty multisets of tool outcomes up to `maxLength`. */
function combinations(maxLength: number): ToolOutcome[][] {
  const all: ToolOutcome[][] = []
  const recurse = (prefix: ToolOutcome[]): void => {
    if (prefix.length > 0) all.push([...prefix])
    if (prefix.length === maxLength) return
    for (const o of TOOL_OUTCOMES) recurse([...prefix, o])
  }
  recurse([])
  return all
}

describe('reduceStageOutcome', () => {
  it('is total over every combination up to three tools', () => {
    let count = 0
    for (const combo of combinations(3)) {
      const { outcome, verdict } = reduceStageOutcome(combo)
      expect(VALID_STAGE.has(outcome), `no outcome for ${combo.join('+')}`).toBe(true)
      expect(['passed', 'failed']).toContain(verdict)
      count += 1
    }
    expect(count).toBe(4 + 16 + 64)
  })

  it('throws on an empty selection rather than inventing an outcome', () => {
    expect(() => reduceStageOutcome([])).toThrow(/empty/)
  })

  it('passes when every tool passed', () => {
    expect(reduceStageOutcome(['passed', 'passed']).outcome).toBe('passed')
  })

  it('fails when a tool failed and the stage is otherwise complete', () => {
    expect(reduceStageOutcome(['passed', 'failed']).outcome).toBe('failed')
  })

  it('degrades when one tool ran and another errored', () => {
    expect(reduceStageOutcome(['passed', 'errored']).outcome).toBe('degraded')
    expect(reduceStageOutcome(['failed', 'errored']).outcome).toBe('degraded')
  })

  it('degrades when one tool ran and another was skipped', () => {
    expect(reduceStageOutcome(['passed', 'skipped']).outcome).toBe('degraded')
    expect(reduceStageOutcome(['failed', 'skipped']).outcome).toBe('degraded')
  })

  it('errors when nothing ran and something errored', () => {
    expect(reduceStageOutcome(['errored']).outcome).toBe('errored')
    expect(reduceStageOutcome(['errored', 'skipped']).outcome).toBe('errored')
  })

  it('skips only when every tool was skipped', () => {
    expect(reduceStageOutcome(['skipped', 'skipped']).outcome).toBe('skipped')
  })

  it('carries the verdict through a degraded stage', () => {
    expect(reduceStageOutcome(['failed', 'errored']).verdict).toBe('failed')
    expect(reduceStageOutcome(['passed', 'errored']).verdict).toBe('passed')
  })

  it('reduces a single tool to its own outcome', () => {
    for (const o of TOOL_OUTCOMES) {
      expect(reduceStageOutcome([o]).outcome).toBe(o)
    }
  })
})

describe('haltsChain', () => {
  it('continues only on passed', () => {
    expect(haltsChain('passed')).toBe(false)
    for (const o of ['failed', 'degraded', 'errored', 'skipped'] as StageOutcome[]) {
      expect(haltsChain(o)).toBe(true)
    }
  })
})
