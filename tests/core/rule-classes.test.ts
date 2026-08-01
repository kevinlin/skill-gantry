import { describe, expect, it } from 'vitest'
import {
  RULE_CLASS_MAP,
  RULE_CLASS_MAP_VERSION,
  classifyRule,
  isUnmappedFor,
  unmappedClass,
} from '../../src/core/adapters/rule-classes.js'
import { KNOWN_RULE_CLASSES } from '../../src/core/types.js'

describe('classifyRule', () => {
  it('maps a known skillspector rule', () => {
    expect(classifyRule('skillspector', 'LP3')).toBe('excessive-permission')
  })

  it('maps the context-stuffing rule to prompt injection', () => {
    expect(classifyRule('skillspector', 'MP2')).toBe('prompt-injection')
  })

  it('falls back to a tool-scoped class for an unknown rule', () => {
    expect(classifyRule('skillspector', 'ZZ9')).toBe('unmapped:skillspector:ZZ9')
  })

  it('never merges unmapped rules across tools', () => {
    expect(classifyRule('skillspector', 'X1')).not.toBe(classifyRule('skill-scanner', 'X1'))
  })

  it('only ever produces a known class or an unmapped one', () => {
    const known = new Set<string>(KNOWN_RULE_CLASSES)
    for (const id of ['LP3', 'MP2', 'ZZ9']) {
      const cls = classifyRule('skillspector', id)
      expect(known.has(cls) || cls.startsWith('unmapped:')).toBe(true)
    }
  })
})

describe('skillspector static rule map', () => {
  // Every rule id observed across all 20 skills of zapac-agent-skills at the
  // pinned version. An id missing here degrades to unmapped: and can never
  // merge with another tool's finding.
  const OBSERVED = {
    AS1: 'excessive-permission', AS3: 'excessive-permission', AST4: 'unsafe-script',
    E2: 'credential-access', EA2: 'excessive-permission', EA4: 'excessive-permission',
    LP3: 'excessive-permission', MP2: 'prompt-injection', P2: 'prompt-injection',
    P6: 'data-exfiltration', PE2: 'excessive-permission', PE3: 'credential-access',
    RA2: 'excessive-permission', RP1: 'vulnerable-dep', YR4: 'unsafe-script',
  } as const

  it('classifies every rule the pinned version actually produced', () => {
    for (const [id, expected] of Object.entries(OBSERVED)) {
      expect(classifyRule('skillspector', id)).toBe(expected)
    }
  })

  it('maps only onto known classes', () => {
    for (const byTool of Object.values(RULE_CLASS_MAP)) {
      for (const cls of Object.values(byTool)) {
        expect(KNOWN_RULE_CLASSES).toContain(cls)
      }
    }
  })

  it('is versioned, so a map change cannot ship without a migration', () => {
    expect(RULE_CLASS_MAP_VERSION).toBeGreaterThanOrEqual(2)
  })
})

describe('isUnmappedFor', () => {
  it('recognises a tool own unmapped class', () => {
    expect(isUnmappedFor(unmappedClass('skillspector', 'ZZ9'), 'skillspector')).toBe(true)
  })

  it('rejects another tool unmapped class', () => {
    expect(isUnmappedFor(unmappedClass('skill-scanner', 'ZZ9'), 'skillspector')).toBe(false)
  })

  it('rejects a known class', () => {
    expect(isUnmappedFor('prompt-injection', 'skillspector')).toBe(false)
  })
})
