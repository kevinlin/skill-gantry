import { describe, expect, it } from 'vitest'
import { KNOWN_RULE_CLASSES, METRIC_KEYS, coerceMetrics } from '../../src/core/types.js'

describe('metric keys', () => {
  it('has no token or cost key', () => {
    for (const key of METRIC_KEYS) {
      expect(key).not.toMatch(/token|cost|price|usd/i)
    }
  })

  it('keeps known keys', () => {
    expect(coerceMetrics({ durationMs: 12, casesPassed: 3 })).toEqual({
      durationMs: 12,
      casesPassed: 3,
    })
  })

  it('throws on an unknown key so token fields cannot leak in', () => {
    expect(() => coerceMetrics({ input_tokens: 900 })).toThrow(/unknown metric key: input_tokens/)
  })

  it('throws on a non-finite value', () => {
    expect(() => coerceMetrics({ durationMs: Number.NaN })).toThrow(/non-finite/)
  })
})

describe('rule classes', () => {
  it('contains the twelve known classes and no duplicates', () => {
    expect(KNOWN_RULE_CLASSES).toHaveLength(12)
    expect(new Set(KNOWN_RULE_CLASSES).size).toBe(12)
  })
})
