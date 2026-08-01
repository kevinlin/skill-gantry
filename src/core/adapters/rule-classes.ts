import { KNOWN_RULE_CLASSES, type KnownRuleClass, type RuleClass } from '../types.js'

const KNOWN = new Set<string>(KNOWN_RULE_CLASSES)

/**
 * The map version. Every change to RULE_CLASS_MAP bumps this and appends a
 * migration in ledger/rule-map-migration.ts, because a new mapping changes the
 * fingerprint of every issue already recorded under the old unmapped: class.
 * Extending the map without a bump silently orphans a user's triage — R8.14.
 */
export const RULE_CLASS_MAP_VERSION = 2

/**
 * (toolId, nativeRuleId) -> canonical class. Every entry below was observed in
 * real output from the pinned version, swept across all 20 skills of the
 * reference repo; nothing is mapped speculatively, because a wrong mapping
 * merges two unrelated problems into one issue and there is no signal that
 * would ever separate them again.
 */
export const RULE_CLASS_MAP: Readonly<Record<string, Readonly<Record<string, KnownRuleClass>>>> = {
  skillspector: {
    AS1: 'excessive-permission',   // Agent Config Directory Access
    AS3: 'excessive-permission',   // Skill Enumeration
    AST4: 'unsafe-script',         // subprocess module call
    E2: 'credential-access',       // Env Variable Harvesting
    EA2: 'excessive-permission',   // Autonomous Decision Making
    EA4: 'excessive-permission',   // Unbounded Resource Access
    LP3: 'excessive-permission',   // capabilities detected with no declared permissions
    MP2: 'prompt-injection',       // Context Window Stuffing
    P2: 'prompt-injection',        // Hidden Instructions
    P6: 'data-exfiltration',       // Direct Prompt Extraction
    PE2: 'excessive-permission',   // Sudo/Root Execution
    PE3: 'credential-access',      // Credential Access
    RA2: 'excessive-permission',   // Session Persistence
    RP1: 'vulnerable-dep',         // MCP server referenced without a pinned version
    YR4: 'unsafe-script',          // YARA signature match
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
