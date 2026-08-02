import { parseSarif } from './sarif.js'
import type { AdapterManifest, Parse } from './types.js'

/**
 * skill-scanner 0.3.3 has no static mode. `scan --no-ai --no-vt` prints "No
 * analyzers enabled for scan" and writes no report, so unlike skillspector
 * there is no offline analysis to pin. The adapter therefore declares LLM mode
 * and the credential sets that mode accepts, and reports
 * `skipped`/`no-credentials` when the user has none — which is the fail-safe
 * R4.10 asks for: a selected tool that cannot run is never silently dropped,
 * and a skipped tool closes no issue.
 *
 * VirusTotal is a different analyser covering different rule classes, so it is
 * a separate adapter id if it is ever wanted, never a fallback from this one.
 * R4.2b: a silent mode change makes two runs' statistics incomparable.
 *
 * Its findings are nondeterministic, so the golden fixture is a point-in-time
 * capture. The parse test asserts what the parser does with those bytes, not
 * that a re-run reproduces them.
 */
export const manifest: AdapterManifest = {
  id: 'skill-scanner',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  // The three classes the capture's rule ids map onto. Under §10.4 a too-narrow
  // list costs completeness rather than correctness, and it is widened at
  // runtime by whatever the tool has actually reported — but it must not name a
  // class no observed rule produces.
  detects: ['credential-access', 'unsafe-script', 'prompt-injection'],
  credentials: {
    kind: 'one-of',
    alternatives: [
      // `skill-scanner doctor`: "LLM analysis requires an explicit
      // SKILLSCAN_MODEL or --model value. No default model is applied."
      { provider: 'Hosted model', required: ['SKILLSCAN_API_KEY', 'SKILLSCAN_MODEL'] },
      { provider: 'Local or gateway model', required: ['SKILLSCAN_BASE_URL', 'SKILLSCAN_MODEL'] },
    ],
  },
  analysisMode: 'llm',
  install: { kind: 'uv-tool', spec: 'skill-scanner', pin: '0.3.3', binName: 'skill-scanner' },
  invoke: {
    argv: [
      'scan',
      '--path',
      '{skillDir}',
      '--no-vt',
      '--format',
      'sarif',
      '--output',
      '{toolDir}/findings.sarif',
    ],
    cwd: 'repoRoot',
  },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  timeoutMs: 600_000,
}

export const parse: Parse = (ctx) => {
  const bytes = ctx.artefacts.get('findings.sarif')
  if (!bytes) {
    return {
      outcome: 'errored',
      findings: [],
      metrics: {},
      summary: 'skill-scanner produced no findings.sarif',
    }
  }
  const result = parseSarif(bytes, { toolId: manifest.id, skillRelPath: ctx.skill.relPath })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
