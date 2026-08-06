import type { RawFinding, Severity } from '../types.js'
import { rebasePath } from './paths.js'
import { classifyRule } from './rule-classes.js'
import type { ToolResult } from './types.js'

export { rebasePath }

const LEVEL_TO_SEVERITY: Readonly<Record<string, Severity>> = {
  error: 'high',
  warning: 'medium',
  note: 'low',
  none: 'info',
}

interface SarifRegion {
  startLine?: number
}
interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: { uri?: string }
    region?: SarifRegion
  }
}
interface SarifSuppression {
  kind?: string
  status?: string
  justification?: string
}
interface SarifResult {
  ruleId?: string
  level?: string
  message?: { text?: string }
  locations?: SarifLocation[]
  suppressions?: SarifSuppression[]
}
interface SarifDoc {
  runs?: Array<{ results?: SarifResult[] }>
}

function errored(summary: string): ToolResult {
  return { outcome: 'errored', findings: [], metrics: {}, summary }
}

/**
 * R4.15. The suppression in force, or undefined.
 *
 * SARIF §3.27.23: an EMPTY `suppressions` array means "explicitly not
 * suppressed", an ABSENT one means "no information" — a truthiness test on the
 * array conflates the two. `rejected` and `underReview` have not taken effect;
 * an absent `status` defaults to `accepted`, which is what skillspector 2.5.1
 * emits.
 */
function suppressionOf(res: SarifResult): { justification: string } | undefined {
  if (!Array.isArray(res.suppressions)) return undefined
  const active = res.suppressions.find((s) => (s.status ?? 'accepted') === 'accepted')
  if (!active) return undefined
  return { justification: active.justification ?? '' }
}

export interface SarifParseOptions {
  toolId: string
  /** Repo-relative path of the scanned skill; '.' for a repo-root skill. */
  skillRelPath: string
}

export function parseSarif(bytes: Buffer, opts: SarifParseOptions): ToolResult {
  let doc: SarifDoc
  try {
    doc = JSON.parse(bytes.toString('utf8')) as SarifDoc
  } catch {
    return errored('SARIF output could not be parsed as JSON')
  }
  if (!Array.isArray(doc.runs)) {
    return errored('SARIF output could not be parsed: no runs array')
  }

  const findings: RawFinding[] = []
  for (const run of doc.runs) {
    for (const res of run.results ?? []) {
      const nativeRuleId = res.ruleId ?? 'unknown'
      const physical = res.locations?.[0]?.physicalLocation
      const uri = physical?.artifactLocation?.uri ?? ''
      const line = physical?.region?.startLine

      const finding: RawFinding = {
        ruleClass: classifyRule(opts.toolId, nativeRuleId),
        nativeRuleId,
        severity: LEVEL_TO_SEVERITY[res.level ?? 'warning'] ?? 'medium',
        path: rebasePath(opts.skillRelPath, uri),
        message: res.message?.text ?? nativeRuleId,
      }
      if (typeof line === 'number') finding.line = line
      // Assigned conditionally, not as `undefined`: `exactOptionalPropertyTypes`
      // is on, the same reason `line` above is written this way.
      const suppressed = suppressionOf(res)
      if (suppressed) finding.suppressed = suppressed
      findings.push(finding)
    }
  }

  // `outcome`, the count and `findingsTotal` are deliberately blind to
  // suppression: the parser's verdict is "did I see anything", and a count that
  // drops when a user edits a YAML file makes "did this skill improve"
  // unanswerable. §8.1 owns the gate; the summary names the split so the
  // lifecycle rail says the flag fired.
  const suppressedCount = findings.filter((f) => f.suppressed).length
  const plural = findings.length === 1 ? '' : 's'

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: { findingsTotal: findings.length },
    summary:
      findings.length === 0
        ? 'no findings'
        : suppressedCount === 0
          ? `${findings.length} finding${plural}`
          : `${findings.length} finding${plural}, ${suppressedCount} suppressed`,
  }
}
