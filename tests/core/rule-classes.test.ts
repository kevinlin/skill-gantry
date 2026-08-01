import { describe, expect, it } from 'vitest'
import { classifyRule, isUnmappedFor, unmappedClass } from '../../src/core/adapters/rule-classes.js'
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
