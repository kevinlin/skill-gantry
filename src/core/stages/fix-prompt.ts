import { join } from 'node:path'
import { getAdapter } from '../adapters/registry.js'
import { maxSeverity, type Severity, type SkillRef } from '../types.js'
import {
  attributedRows,
  cell,
  location,
  suppressSection,
  verifySection,
  type ManifestLookup,
} from './prompt-parts.js'
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

  // The outcome and nothing else: a `passed` stage still gets a prompt when it
  // carries sub-floor findings (§8.1), and telling that agent the release is
  // blocked would be false.
  const purpose =
    result.outcome === 'passed'
      ? ' The gate passed; these findings are still on record as open issues.'
      : ' The skill cannot be released until this gate passes.'

  // Numbered at render time: the accept instruction is absent when no
  // detecting tool declares a baseline, and a gap in the numbering reads as a
  // prompt that lost a step.
  const instructions = [
    "Read the tool report listed above before you read this table. The report carries `properties.explanation`, `properties.remediation`, `properties.confidence` and `properties.code_snippet`; the table below cannot, because SkillGantry normalises every finding to six fields and drops the rest. Judge from the report, not from the table alone.",
    'Judge each finding into exactly one of three: correct and worth fixing; correct, but the remediation the tool suggests does not apply here; a false positive.',
    'Fix only what you judged correct and worth fixing, with the smallest change that removes the cause.',
    // Not "stop and report": that sat one line above the instruction to record
    // a false positive, and an agent that stopped never reached it.
    'Where the code is right and the finding is wrong, leave the code as it is, say so in your report, and carry on with the other findings. Do not edit correct code to satisfy a scanner — an open finding is better than a quietly broken skill.',
    ...(canAccept
      ? [
          'Where you confirmed a finding is a false positive and its tool keeps a suppression file, record it there with the command below and say why. Record nothing you did not judge false.',
        ]
      : []),
    'Never write anything under `*-workspace/` or `.skillgantry-workspace/`. That is the run evidence this prompt points at.',
    'A finding you deliberately did not fix will still be reported when you re-verify, and that is expected.',
  ]

  return `${[
    `# Fix the ${result.stage} findings on ${skill.id}`,
    '',
    // Whose work this is and what it is for, before anything else: an
    // instruction with no purpose is followed to the letter.
    `You are working for the maintainer of this skill. SkillGantry ran its ${result.stage} gate over the skill and it reported the findings below. Your job is to decide what each finding is worth and act on it.${purpose}`,
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
    ...verifySection(skill.id, [result.stage]),
    '',
    '## Done when',
    '',
    "Every finding above has one of the three judgements and an action, and you have re-verified once after your last change. The gate does not have to pass: a finding you were right to leave open keeps it failing, and that is the maintainer's call.",
    '',
    '## Report back',
    '',
    'One line per finding: its number, which of the three judgements you reached, and what you did — changed it, recorded it as a false positive, or nothing and why.',
  ].join('\n')}\n`
}
