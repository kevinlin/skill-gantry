import type { RawFinding } from '../types.js'
import { rebasePath } from './paths.js'
import type { ToolResult } from './types.js'

const SCHEMA_VERSION = 'v1alpha1'

interface AssertionResult {
  text?: string
  passed?: boolean
  evidence?: string
}

interface CaseResult {
  case_id?: string
  title?: string
  status?: string
  turns?: number
  grading?: { assertion_results?: AssertionResult[] }
}

interface EvalReport {
  schema_version?: string
  case_results?: CaseResult[]
}

export interface EvalReportOptions {
  toolId: string
  /** Repo-relative path of the evaluated skill; '.' for a repo-root skill. */
  skillRelPath: string
}

const errored = (summary: string): ToolResult => ({
  outcome: 'errored',
  findings: [],
  metrics: {},
  summary,
})

/**
 * Shared parser for skill-up's `v1alpha1` report — the second of the two R4.4
 * names, alongside sarif.ts. It lives in the engine so a future evaluate
 * harness emitting the same schema needs no parser of its own.
 *
 * A case result carries no file path, so a failure is pathed at the case file
 * skill-up's own layout implies. Pathing every failure at `evals/eval.yaml`
 * instead would collapse a whole failing suite into one issue, because identity
 * is (skillId, relPath, ruleClass) and the path is the only field that can
 * separate two failing cases. See design §7.2.
 *
 * Token fields present in the report are dropped rather than mapped: MetricKey
 * has no key that could hold them, and coerceMetrics throws on an unknown one.
 */
export function parseEvalReport(bytes: Buffer, opts: EvalReportOptions): ToolResult {
  let doc: EvalReport
  try {
    doc = JSON.parse(bytes.toString('utf8')) as EvalReport
  } catch {
    return errored('eval report could not be parsed as JSON')
  }

  if (doc.schema_version !== SCHEMA_VERSION) {
    return errored(
      `eval report is ${String(doc.schema_version)}, this parser is pinned to ${SCHEMA_VERSION}`,
    )
  }

  const cases = doc.case_results ?? []
  const findings: RawFinding[] = []
  let passed = 0
  let errors = 0
  let turns = 0

  for (const c of cases) {
    const status = (c.status ?? '').toUpperCase()
    turns += c.turns ?? 0
    if (status === 'PASS') {
      passed += 1
      continue
    }
    if (status === 'ERROR') errors += 1

    const caseId = c.case_id ?? 'unknown'
    const failed = (c.grading?.assertion_results ?? []).filter((a) => a.passed === false)
    const detail = failed.map((a) => a.evidence ?? a.text ?? '').filter(Boolean).join('; ')

    findings.push({
      ruleClass: 'eval-failure',
      nativeRuleId: caseId,
      severity: status === 'ERROR' ? 'high' : 'medium',
      path: rebasePath(opts.skillRelPath, `evals/cases/${caseId}.yaml`),
      message: detail === '' ? (c.title ?? caseId) : `${c.title ?? caseId}: ${detail}`,
    })
  }

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: {
      casesTotal: cases.length,
      casesPassed: passed,
      casesErrored: errors,
      turns,
    },
    summary: `${passed}/${cases.length} cases passed`,
  }
}
