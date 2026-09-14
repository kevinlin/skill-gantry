import { parseSarif } from './sarif.js'
import type { AdapterManifest, Parse } from './types.js'

/**
 * `--no-llm` is not optional, and `credentials`/`analysisMode` must agree with
 * it. SkillSpector's `scan` runs LLM analysis by default and aborts unless a
 * provider key is present; its LLM findings are also nondeterministic, which
 * would make golden fixtures worthless. Declaring static mode makes the
 * narrower coverage visible in provenance instead of silently degrading.
 *
 * `detects` covers static analysis only, and is re-derived by
 * scripts/capture-fixtures.sh rather than hand-maintained. `vulnerable-dep` is
 * absent because the dependency analysis proper is an LLM-mode analyser.
 *
 * AE1 is declared a coverage notice rather than a finding: 2.10.0 added
 * "Referenced artifact was not completely inspected", which reports on the scan
 * rather than on the skill. It was 18 of the 148 results over the reference
 * repo, and each would have become an issue a maintainer cannot close by
 * editing their own tree.
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
    pin: 'v2.11.2',
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
    // R4.14. skillspector applies a baseline only when it is passed one. 2.9.5
    // taught `scan` to *notice* a `.skillspector-baseline.yaml` in the scanned
    // directory, but it still refuses to apply it without
    // `--use-shipped-baseline` — a skill author's own suppressions must not
    // silently quieten someone else's scan. Passing `--baseline` explicitly
    // both keeps that decision ours and skips the discovery path entirely. The
    // path carries the substitution vocabulary rather than being relative,
    // because `cwd` here is `repoRoot`.
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
  // 2.11.x is several times slower than 2.5.1 on the same input: the reference
  // repo's worst skill went from 8s to 63s, and upstream raised its own
  // end-to-end deadline from 60s to 600s in 2.11.1. A 120s ceiling would now
  // kill slow-but-healthy scans and report them as errored, so it sits above
  // upstream's own budget for a single skill rather than under it.
  timeoutMs: 300_000,
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
  const result = parseSarif(bytes, {
    toolId: manifest.id,
    skillRelPath: ctx.skill.relPath,
    coverageRuleIds: ['AE1'],
  })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
