import { parseSarif } from './sarif.js'
import type { AdapterManifest, Parse } from './types.js'

/**
 * `--no-llm` is not optional, and `credentials`/`analysisMode` must agree with
 * it. SkillSpector 2.5.1's `scan` runs LLM analysis by default and aborts
 * unless a provider key is present; its LLM findings are also nondeterministic,
 * which would make golden fixtures worthless. Declaring static mode makes the
 * narrower coverage visible in provenance instead of silently degrading.
 *
 * `detects` covers static analysis only, and is re-derived by
 * scripts/capture-fixtures.sh rather than hand-maintained. `vulnerable-dep` is
 * absent because dependency findings are an LLM-mode analyser in 2.5.1.
 */
/**
 * One constant for the flag and the writer. The registry test asserts the two
 * agree for every adapter, but a shared constant makes them agree at compile
 * time for this one.
 */
const BASELINE_PATH = '{skillDir}/.skillspector-baseline.yaml'

export const manifest: AdapterManifest = {
  id: 'skillspector',
  stage: 'security',
  policy: 'fan-out',
  mutating: false,
  detects: [
    'prompt-injection',
    'credential-access',
    'unsafe-script',
    'data-exfiltration',
    'excessive-permission',
  ],
  credentials: { kind: 'none' },
  analysisMode: 'static',
  install: {
    kind: 'uv-tool',
    spec: 'git+https://github.com/NVIDIA/skillspector.git',
    pin: 'v2.5.1',
    binName: 'skillspector',
  },
  invoke: {
    argv: [
      'scan',
      '{skillDir}',
      '--no-llm',
      '--format',
      'sarif',
      '--output',
      '{toolDir}/findings.sarif',
    ],
    cwd: 'repoRoot',
    // R4.14. skillspector 2.5.1 reads a baseline only when it is passed one:
    // `.skillspector-baseline.yaml` is where `skillspector baseline` writes,
    // not somewhere `scan` looks. The path carries the substitution vocabulary
    // rather than being relative, because `cwd` here is `repoRoot`.
    conditionalArgv: [
      {
        whenExists: BASELINE_PATH,
        argv: ['--baseline', BASELINE_PATH],
      },
    ],
  },
  versionArgv: ['--version'],
  artefacts: ['findings.sarif'],
  baseline: {
    path: BASELINE_PATH,
    document: 'yaml',
    collection: 'rules',
    // v2 with an empty `fingerprints` needs no `scanner_version`; a v2 with
    // entries does, and SkillGantry never writes one — the fingerprint form
    // hashes the whole file's content plus every finding field, so it cannot
    // be authored from SARIF and self-invalidates on the next edit anyway.
    scaffold: { version: 2, rules: [], fingerprints: [] },
    entry: { id: '{ruleIdGlob}', path: '{pathGlob}', reason: '{reason}' },
  },
  timeoutMs: 120_000,
}

export const parse: Parse = (ctx) => {
  const bytes = ctx.artefacts.get('findings.sarif')
  if (!bytes) {
    return {
      outcome: 'errored',
      findings: [],
      metrics: {},
      summary: 'skillspector produced no findings.sarif',
    }
  }
  const result = parseSarif(bytes, { toolId: manifest.id, skillRelPath: ctx.skill.relPath })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
