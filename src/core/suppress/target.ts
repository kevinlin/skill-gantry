import { getAdapter } from '../adapters/registry.js'
import type { DetectionRule } from '../ledger/issue-queries.js'
import type { SkillRef } from '../types.js'
import { skillRelative, suppressionEntry } from './entry.js'
import { planSuppression, type SuppressionPlan } from './write.js'

/**
 * What the two surfaces ask for, before anything has opened the ledger. Kept
 * here rather than in the TUI because the CLI asks the same question, and two
 * request shapes is how the two surfaces come to accept different things.
 */
export type SuppressionRequest =
  | { kind: 'issue'; skillId: string; fingerprint: string; reason: string }
  | {
      kind: 'finding'
      skillId: string
      toolId: string
      nativeRuleId: string
      relPath: string
      reason: string
    }

export interface SuppressionPreview {
  plans: SuppressionPlan[]
  /**
   * Detectors still reporting the issue whose tool declares no baseline.
   * §10.4 reads an issue suppressed only when every tool still reporting it
   * reports it suppressed, so one of these leaves the gate failing — which the
   * user has to be told before the write, not after the re-run.
   */
  uncovered: string[]
  reason: string
}

export interface PreviewInput {
  skill: SkillRef
  reason: string
  rules: readonly DetectionRule[]
  /** R8.8's blockers: the detectors that have not since reported it absent. */
  stillReporting: readonly string[]
}

export async function previewSuppression(input: PreviewInput): Promise<SuppressionPreview> {
  const { skill, reason, rules, stillReporting } = input
  if (reason.trim() === '') throw new Error('a suppression reason is required')

  const byTool = new Map<string, DetectionRule[]>()
  for (const rule of rules) {
    byTool.set(rule.toolId, [...(byTool.get(rule.toolId) ?? []), rule])
  }

  const plans: SuppressionPlan[] = []
  const uncovered: string[] = []
  for (const [toolId, toolRules] of [...byTool].sort(([a], [b]) => a.localeCompare(b))) {
    const spec = getAdapter(toolId)?.manifest.baseline
    if (spec === undefined) {
      if (stillReporting.includes(toolId)) uncovered.push(toolId)
      continue
    }
    const entries = toolRules.map((rule) =>
      suppressionEntry(spec, {
        nativeRuleId: rule.nativeRuleId,
        skillRelativePath: skillRelative(rule.relPath, skill.relPath),
        reason,
      }),
    )
    plans.push(await planSuppression({ skill, toolId, spec, entries }))
  }
  return { plans, uncovered, reason }
}
