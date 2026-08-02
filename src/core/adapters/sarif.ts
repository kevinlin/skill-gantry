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
interface SarifResult {
  ruleId?: string
  level?: string
  message?: { text?: string }
  locations?: SarifLocation[]
}
interface SarifDoc {
  runs?: Array<{ results?: SarifResult[] }>
}

function errored(summary: string): ToolResult {
  return { outcome: 'errored', findings: [], metrics: {}, summary }
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
      findings.push(finding)
    }
  }

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: { findingsTotal: findings.length },
    summary:
      findings.length === 0
        ? 'no findings'
        : `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
  }
}
