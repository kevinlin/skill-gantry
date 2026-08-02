import { describe, expect, it } from 'vitest'
import {
  FAIL_SEVERITY_FLOOR,
  TOOL_OUTCOMES,
  haltsChain,
  highestSeverity,
  meetsFailFloor,
  reduceStageOutcome,
} from '../../src/core/stages/outcome.js'
import { atLeastSeverity } from '../../src/core/types.js'
import type { RawFinding, Severity, StageOutcome, ToolOutcome } from '../../src/core/types.js'

const finding = (severity: Severity): RawFinding => ({
  ruleClass: 'unsafe-script',
  nativeRuleId: 'R06',
  severity,
  path: 'declawed/scripts/scan.py',
  message: 'bundled script',
})

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

describe('the fail floor', () => {
  it('sits at medium, so only low and info are advisory', () => {
    expect(FAIL_SEVERITY_FLOOR).toBe('medium')
    for (const s of ['critical', 'high', 'medium'] as Severity[]) {
      expect(meetsFailFloor(s), s).toBe(true)
    }
    for (const s of ['low', 'info'] as Severity[]) {
      expect(meetsFailFloor(s), s).toBe(false)
    }
  })

  it('orders severity strictly', () => {
    expect(atLeastSeverity('critical', 'info')).toBe(true)
    expect(atLeastSeverity('medium', 'medium')).toBe(true)
    expect(atLeastSeverity('low', 'medium')).toBe(false)
  })

  it('reports the highest of a mixed set, and null for none', () => {
    expect(highestSeverity([finding('low'), finding('high'), finding('info')])).toBe('high')
    expect(highestSeverity([finding('low'), finding('low')])).toBe('low')
    // null rather than 'info', so an empty set cannot read as a real severity.
    expect(highestSeverity([])).toBeNull()
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
