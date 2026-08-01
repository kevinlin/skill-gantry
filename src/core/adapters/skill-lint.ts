import type { RawFinding, Severity } from '../types.js'
import { rebasePath } from './paths.js'
import { classifyRule } from './rule-classes.js'
import type { AdapterManifest, Parse, ToolResult } from './types.js'

/**
 * skill-lint writes its whole report to stdout and offers no --output flag, so
 * this is the first adapter declaring no artefact. Row 7 of the §8.1 table, a
 * declared artefact missing after exit, therefore cannot fire for it; a tool
 * that produced nothing usable is caught by the schema check in parse instead.
 *
 * It stays a validate tool although three of its four rules are security rules:
 * R09 checks SKILL.md frontmatter, which is validate's job, and agentskills —
 * validate's other D7 candidate — is unpublished, so moving it would leave the
 * first gate with no tool. Its security-class findings still merge with
 * skillspector's, because the fingerprint carries no stage component.
 */
export const manifest: AdapterManifest = {
  id: 'skill-lint',
  stage: 'validate',
  policy: 'fan-out',
  mutating: false,
  detects: ['unsafe-script', 'vulnerable-dep', 'excessive-permission', 'metadata-invalid'],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: { kind: 'npm-prefix', spec: 'skill-lint', pin: '0.2.0', binName: 'skill-lint' },
  invoke: { argv: ['{skillDir}', '--json'], cwd: 'repoRoot' },
  versionArgv: ['--version'],
  artefacts: [],
  timeoutMs: 60_000,
}

const SCHEMA_VERSION = 1

const SEVERITY: Readonly<Record<string, Severity>> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
}

interface Finding {
  ruleId?: string
  severity?: string
  file?: string
  message?: string
  title?: string
}

interface Report {
  schemaVersion?: number
  skill?: { files?: unknown[] }
  findings?: Finding[]
}

const errored = (summary: string): ToolResult => ({
  outcome: 'errored',
  findings: [],
  metrics: {},
  summary,
})

export const parse: Parse = (ctx) => {
  let doc: Report
  try {
    doc = JSON.parse(ctx.stdout) as Report
  } catch {
    return errored('skill-lint stdout was not JSON')
  }

  // Pinned rather than tolerated: upstream schema drift must surface as
  // `errored` with the log retained, never as a confidently wrong result.
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    return errored(`unexpected skill-lint schemaVersion: ${String(doc.schemaVersion)}`)
  }

  const findings: RawFinding[] = (doc.findings ?? []).map((f) => {
    const nativeRuleId = f.ruleId ?? 'unknown'
    return {
      ruleClass: classifyRule(manifest.id, nativeRuleId),
      nativeRuleId,
      severity: SEVERITY[f.severity ?? ''] ?? 'medium',
      path: rebasePath(ctx.skill.relPath, f.file ?? ''),
      message: f.message ?? f.title ?? nativeRuleId,
    }
  })

  return {
    outcome: findings.length === 0 ? 'passed' : 'failed',
    findings,
    metrics: {
      findingsTotal: findings.length,
      filesScanned: doc.skill?.files?.length ?? 0,
      durationMs: ctx.durationMs,
    },
    summary:
      findings.length === 0
        ? 'no findings'
        : `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
  }
}
