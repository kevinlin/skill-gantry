import { parseEvalReport } from './eval-report.js'
import type { AdapterManifest, Parse } from './types.js'

const REPORT = 'iteration-1/report.json'

/**
 * `--output-dir {toolDir}` is not optional. skill-up's default output is
 * `<skill-name>-workspace` alongside the skill — the sidecar SkillGantry owns —
 * and it writes `iteration-N` there, which is exactly what R6.5 forbids
 * SkillGantry to touch. Redirecting into the run's tool directory keeps the
 * user's hand-run iterations intact and puts this run's report where
 * `tool_runs.artefact_dir` already points.
 *
 * `--iteration 1` pins the directory name so the declared artefact path is
 * knowable. The tool directory is created fresh per run, so auto-numbering
 * would land on `iteration-1` anyway; the flag makes that a contract rather
 * than a coincidence.
 *
 * `credentials: { kind: 'none' }` is honest rather than convenient: the Agent
 * Engine is declared by the skill's own `evals/eval.yaml` — `claude_code` in
 * every reference skill — and skill-up resolves that CLI's authentication
 * itself. CredentialRequirement can say "these env keys are set"; it cannot say
 * "an external CLI is logged in". A missing engine therefore surfaces as
 * errored/missing-artefact, not skipped/no-credentials. See the known gaps.
 */
export const manifest: AdapterManifest = {
  id: 'skill-up',
  stage: 'evaluate',
  policy: 'pick-one',
  mutating: false,
  detects: ['eval-failure'],
  credentials: { kind: 'none' },
  analysisMode: 'engine-from-eval-yaml',
  install: {
    kind: 'gh-release',
    repo: 'alibaba/skill-up',
    pin: 'v0.7.0',
    assetPattern: 'skill-up_0\\.7\\.0_{os}_{arch}\\.tar\\.gz',
    binName: 'skill-up',
    integrity: { kind: 'sha256-asset', assetPattern: 'skill-up_0\\.7\\.0_checksums\\.txt' },
  },
  invoke: {
    argv: [
      'run',
      '{skillDir}/evals/eval.yaml',
      '--format',
      'json',
      '--output-dir',
      '{toolDir}',
      '--iteration',
      '1',
    ],
    cwd: 'skillDir',
  },
  versionArgv: ['--version'],
  artefacts: [REPORT],
  // An eval takes minutes, not seconds: declawed's five cases ran 1m54s against
  // claude_code. Fifteen minutes is a ceiling for a hung engine, not a target.
  timeoutMs: 900_000,
}

export const parse: Parse = (ctx) => {
  const bytes = ctx.artefacts.get(REPORT)
  if (!bytes) {
    return {
      outcome: 'errored',
      findings: [],
      metrics: {},
      summary: `skill-up produced no ${REPORT}`,
    }
  }
  const result = parseEvalReport(bytes, {
    toolId: manifest.id,
    skillRelPath: ctx.skill.relPath,
  })
  return { ...result, metrics: { ...result.metrics, durationMs: ctx.durationMs } }
}
