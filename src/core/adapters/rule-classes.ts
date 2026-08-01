import { KNOWN_RULE_CLASSES, type KnownRuleClass, type RuleClass } from '../types.js'

const KNOWN = new Set<string>(KNOWN_RULE_CLASSES)

/**
 * (toolId, nativeRuleId) -> canonical class. Entries are added as real rules
 * are observed; anything absent degrades to a tool-scoped class rather than
 * merging wrongly. Extending this map is a versioned migration, never implicit.
 */
export const RULE_CLASS_MAP: Readonly<Record<string, Readonly<Record<string, KnownRuleClass>>>> = {
  skillspector: {
    LP3: 'excessive-permission',
    MP2: 'prompt-injection',
  },
}

export function unmappedClass(toolId: string, nativeRuleId: string): RuleClass {
  return `unmapped:${toolId}:${nativeRuleId}`
}

export function classifyRule(toolId: string, nativeRuleId: string): RuleClass {
  const mapped = RULE_CLASS_MAP[toolId]?.[nativeRuleId]
  return mapped && KNOWN.has(mapped) ? mapped : unmappedClass(toolId, nativeRuleId)
}

/** True when `ruleClass` is an unmapped class belonging to `toolId`. */
export function isUnmappedFor(ruleClass: RuleClass, toolId: string): boolean {
  return ruleClass.startsWith(`unmapped:${toolId}:`)
}
