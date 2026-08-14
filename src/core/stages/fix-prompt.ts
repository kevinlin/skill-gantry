import { join } from 'node:path'
import { getAdapter } from '../adapters/registry.js'
import { maxSeverity, type Severity, type SkillRef } from '../types.js'
import { attributedRows, cell, suppressSection, type ManifestLookup } from './prompt-parts.js'
import type { StageResult, ToolRunRecord } from './types.js'

export interface FixPromptInput {
  /**
   * The user's real skill. Never `ctx.skill`, which points into the mutation
   * sandbox or the materialised candidate's temp directory — the prompt names
   * where an agent should edit, and neither of those survives the run.
   */
  skill: SkillRef
  runId: string
  /** Absolute `<run>/NN-<stage>`. */
  stageDir: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
  result: StageResult
  /** Injectable so a test need not register an adapter. */
  lookup?: ManifestLookup
}

const location = (path: string, line?: number): string =>
  line === undefined ? path : `${path}:${line}`

function toolReportLines(run: ToolRunRecord, lookup: FixPromptInput['lookup']): string[] {
  const version = run.toolVersion ?? 'unknown version'
  const manifest = (lookup ?? getAdapter)(run.toolId)?.manifest
  const head = `- **${run.toolId}** ${version} — outcome \`${run.outcome}\`, ${run.findings.length} finding(s)`
  const artefacts = manifest?.artefacts ?? []
  const paths =
    artefacts.length > 0
      ? artefacts.map((name) => `  - \`${join(run.artefactDir, name)}\``)
      : // No adapter registered: name the directory rather than guess a filename.
        [`  - \`${run.artefactDir}\` (declared artefacts unknown)`]
  const partial =
    run.findings.length === 0 && (run.outcome === 'errored' || run.outcome === 'skipped')
      ? [
          `  - this tool did not complete, so the picture below is partial: ${run.summary || run.errorKind || run.outcome}`,
        ]
      : []
  return [head, ...paths, ...partial]
}

/**
 * Null when no tool run reported an actionable finding — the trigger, in the
 * one pure place. Findings and not the stage outcome: §8.1's sub-floor row
 * passes the tool while keeping the finding, and that finding is still filed as
 * an issue. Suppressed findings are excluded (R6.11): the one instruction a
 * prompt must never give an agent is to fix what the user has already ruled on,
 * and sub-floor is not suppressed, so the sub-floor case still writes one.
 */
export function buildFixPrompt(input: FixPromptInput): string | null {
  const { skill, result, git } = input
  const { rows, omitted } = attributedRows(result.toolRuns)
  if (rows.length === 0) return null

  const highest = rows.reduce<Severity>((acc, { finding }) => maxSeverity(acc, finding.severity), 'info')
  const stageJson = join(input.stageDir, 'stage.json')

  const where: string[] = [
    '| What | Where |',
    '| --- | --- |',
    `| Skill directory | \`${skill.dir}\` |`,
    `| Repo root | \`${skill.repo.path}\` |`,
  ]
  if (git.commit !== null) {
    const state = git.dirty ? 'dirty — uncommitted changes present' : 'clean'
    where.push(`| Commit | \`${git.commit}\` (${state}) |`)
  }
  where.push(
    `| Skill digest | \`${input.skillDigest}\` |`,
    `| Run id | \`${input.runId}\` |`,
    `| Stage summary | \`${stageJson}\` |`,
  )

  const table = [
    '| # | Tool | Severity | Rule class | Native id | Location | Message |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      ({ toolId, finding: f }, i) =>
        `| ${i + 1} | ${toolId} | ${f.severity} | ${f.ruleClass} | ${cell(f.nativeRuleId)} | \`${location(f.path, f.line)}\` | ${cell(f.message)} |`,
    ),
  ]

  const accept = suppressSection(
    skill,
    rows.map(({ toolId, finding }, i) => ({
      label: `finding ${i + 1}`,
      toolId,
      nativeRuleId: finding.nativeRuleId,
      // The path the table shows. `previewSuppression` rebases it through
      // `skillRelative`, so handing the agent a second path form to retype
      // would only give it one more thing to get wrong.
      path: finding.path,
    })),
    input.lookup,
  )
  /** Named once: an empty section means no detecting tool declares a baseline. */
  const canAccept = accept.length > 0

  const verify = `skillgantry run ${skill.id} --stage ${result.stage}`

  // Numbered at render time: the accept instruction is absent when no
  // detecting tool declares a baseline, and a gap in the numbering reads as a
  // prompt that lost a step.
  const instructions = [
    "Read the tool report listed above before you read this table. The report carries `properties.explanation`, `properties.remediation`, `properties.confidence` and `properties.code_snippet`; the table below cannot, because SkillGantry normalises every finding to six fields and drops the rest. Judge from the report, not from the table alone.",
    'Judge each finding into exactly one of three: correct and worth fixing; correct, but the remediation the tool suggests does not apply here; a false positive.',
    'Fix only what you judged correct and worth fixing, with the smallest change that removes the cause.',
    'Where the code is right and the finding is wrong, stop and report it. Do not edit correct code to satisfy a scanner — an open finding is better than a quietly broken skill.',
    ...(canAccept
      ? [
          'Where you confirmed a finding is a false positive and its tool keeps a suppression file, record it there with the command below and say why. Record nothing you did not judge false.',
        ]
      : []),
    'Never write anything under `*-workspace/` or `.skillgantry-workspace/`. That is the run evidence this prompt points at.',
    `Re-verify with \`${verify}\`. A finding you deliberately did not fix will still be reported, and that is expected.`,
  ]

  return `${[
    `# Fix the ${result.stage} findings on ${skill.id}`,
    '',
    `The ${result.stage} stage ${result.outcome} with ${rows.length} finding(s), the highest of severity \`${highest}\`.`,
    '',
    '## Where things are',
    '',
    ...where,
    '',
    '## Tool reports',
    '',
    ...result.toolRuns.flatMap((run) => toolReportLines(run, input.lookup)),
    '',
    '## Findings',
    '',
    ...table,
    '',
    // Named rather than silently dropped: the agent is told to read the tool's
    // own report first, and that report lists more findings than this table.
    ...(omitted === 0
      ? []
      : [
          `${omitted} further finding(s) are suppressed by this skill's own suppression file and are deliberately omitted. The maintainer has already ruled on them; do not act on them.`,
          '',
        ]),
    'Locations here are repo-relative. Locations inside the tool reports are relative to the skill directory.',
    '',
    '## Do this',
    '',
    ...instructions.map((text, i) => `${i + 1}. ${text}`),
    '',
    ...(canAccept ? [...accept, ''] : []),
    '## Report back',
    '',
    'One line per finding: its number, which of the three judgements you reached, and what you did — changed it, recorded it as a false positive, or nothing and why.',
  ].join('\n')}\n`
}
