import type { SkillRef, Stage } from '../types.js'
import {
  attributedRows,
  cell,
  location,
  suppressSection,
  verifySection,
  type ManifestLookup,
  type SuppressibleFinding,
} from './prompt-parts.js'
import type { StageResult } from './types.js'

export interface OptimisePromptInput {
  /**
   * The user's real skill, never `ctx.skill` — §9.4's rule. There is no run in
   * flight here, but the rule is the same one: the prompt names where an agent
   * should edit, and a sandbox path does not survive to be edited.
   */
  skill: SkillRef
  /**
   * One entry per stage, each from the run that stage's result is taken from —
   * not necessarily the same run for every stage, because a run executes only
   * the stages it was asked for (R6.12). Empty means no recorded run.
   */
  evidence: ReadonlyArray<{
    stage: Stage
    result: StageResult
    runId: string
    runDir: string
    skillDigest: string
    git: { commit: string | null; dirty: boolean }
    /** Recorded against the digest the skill has now. */
    current: boolean
  }>
  /** Repo-relative paths that exist under `<skill>/evals/`. */
  evalAssets: readonly string[]
  /**
   * Plain fields rather than a type from `tools`, so this module adds no §3
   * edge — the property §9.4 records as the reason `fix-prompt.ts` lives here.
   */
  install: { interpreter: string; skillsDir: string; sha: string; missing: readonly string[] }
  /** Injectable so a test need not register an adapter. §9.4's seam. */
  lookup?: ManifestLookup
}

/**
 * R6.12. Returns a string always, unlike `buildFixPrompt`'s nullable return:
 * the trigger here is a user keystroke rather than a findings count, so a
 * refusal is a flash rather than an absent document.
 */
export function buildOptimisePrompt(input: OptimisePromptInput): string {
  const { skill, evidence, install } = input
  const lines: string[] = [
    `# Optimise: ${skill.name}`,
    '',
    'You are working for the maintainer of this skill. They want it to do its job better — sharper triggering, better eval results, fewer findings — without changing what it is for. Below is where the skill is, what SkillGantry has recorded about it, and the optimiser to use.',
    '',
  ]
  const acceptable: SuppressibleFinding[] = []

  lines.push(`- Skill directory: \`${skill.dir}\``)
  lines.push(`- Repo root: \`${skill.repo.path}\``)
  lines.push(`- Declared version: ${skill.version ?? 'none'}`)
  lines.push(`- SkillHone: \`${install.skillsDir}\` at \`${install.sha}\``)
  lines.push(`- Run its scripts with: \`${install.interpreter}\``)
  if (input.evalAssets.length > 0) {
    lines.push(`- Eval assets: ${input.evalAssets.map((path) => `\`${path}\``).join(', ')}`)
  } else {
    lines.push('- Eval assets: none under `evals/` — seed one before measuring')
  }
  lines.push('')

  if (install.missing.length > 0) {
    // Before the task, never after: a prompt describing a loop that cannot
    // start is worse than no prompt, because the failure surfaces inside the
    // agent's session rather than in the terminal that produced it.
    lines.push(`> Missing: ${install.missing.join(', ')}. Resolve these first.`, '')
  }

  lines.push('## Recorded evidence', '')
  if (evidence.length === 0) {
    // Stated rather than omitted: a section that vanishes reads as a builder
    // that failed rather than as a skill that has not run.
    lines.push('There is no recorded run for this skill yet.', '')
  } else {
    // R6.12 names the commit, the dirty flag and the digest. They are one line
    // per run rather than per stage: the stages no longer share a run, and two
    // that did would otherwise repeat the same line.
    const runs = [...new Map(evidence.map((entry) => [entry.runId, entry])).values()]
    for (const { runId, skillDigest, git } of runs) {
      lines.push(
        `Run \`${runId}\` · digest \`${skillDigest}\` · ` +
          `commit \`${git.commit ?? 'none'}\`${git.dirty ? ' (dirty)' : ''}`,
      )
    }
    lines.push('')
    let suppressed = 0
    for (const { stage, result, runId, current } of evidence) {
      lines.push(`### ${stage} — \`${result.outcome}\``, '')
      // Evidence from other bytes is still evidence, but it must not read as a
      // description of the skill as it is today.
      lines.push(
        current
          ? `Recorded by run \`${runId}\` against the skill's current files.`
          : `Recorded by run \`${runId}\` against an earlier version of the skill. Treat it as history, and re-run the stage before relying on it.`,
        '',
      )
      const { rows, omitted } = attributedRows(result.toolRuns)
      suppressed += omitted
      for (const run of result.toolRuns) {
        // §9.4's rule: name the report, do not restate it. `RawFinding` is a
        // closed six-field record, so remediation and explanation are only ever
        // in the tool's own artefacts.
        lines.push(`- **${run.toolId}** \`${run.outcome}\` — report: \`${run.artefactDir}\``)
      }
      if (rows.length > 0) {
        lines.push(
          '',
          '| # | tool | severity | rule class | location | message |',
          '|---|---|---|---|---|---|',
        )
        lines.push(
          ...rows.map(
            ({ toolId, finding }, i) =>
              `| ${i + 1} | ${toolId} | ${finding.severity} | ${finding.ruleClass} | ${cell(location(finding.path, finding.line))} | ${cell(finding.message)} |`,
          ),
        )
        // Mapped over the same array as the table rather than pushed alongside
        // it, so the `i + 1` the label quotes cannot drift from the `#` column.
        // Labelled by stage too: this prompt renders every stage at once and
        // each numbers from 1, so a bare number would collide. The path is the
        // bare one, not the table's `path:line`: `suppress` takes a file.
        acceptable.push(
          ...rows.map(({ toolId, finding }, i) => ({
            label: `${stage} finding ${i + 1}`,
            toolId,
            nativeRuleId: finding.nativeRuleId,
            path: finding.path,
          })),
        )
      }
      lines.push('')
    }
    if (suppressed > 0) {
      // R6.11's rule and its reason: never tell an agent to fix what the user
      // has already ruled on, and say how many were left out so the tool report
      // listing more than the table does not read as a mismatch.
      lines.push(
        `${suppressed} suppressed finding(s) are omitted — the skill's own baseline file accepted them.`,
        '',
      )
    }
  }

  // R6.14, from the same module §9.4's prompt composes it from, so the rule
  // cannot fork into two copies that drift.
  const accept = suppressSection(skill, acceptable, input.lookup)
  if (accept.length > 0) lines.push(...accept, '')

  lines.push('## Task', '')
  lines.push(
    `Use the \`skillhone\` skill to optimise the skill at \`${skill.dir}\`. ` +
      'It dispatches to its own sub-skills; read its SKILL.md before choosing one.',
    '',
  )
  lines.push('## Done when', '')
  lines.push(
    'The eval suite passes at least as well as the recorded evaluate result, no gate that passed now fails, and you can say what you changed and why. With no eval suite there is nothing to measure against: say so, propose one, and stop. An optimisation nobody can measure is a rewrite.',
    '',
  )
  lines.push('## Constraints', '')
  lines.push(
    "- Never write under `*-workspace/` or `.skillgantry-workspace/` — that is SkillGantry's evidence, including the reports named above.",
  )
  lines.push(
    // §9.4's reworded fourth instruction, for its reason: "stop and report" ended
    // the session at the first finding the agent judged wrong.
    '- Judge each finding before changing anything. Leave code you judge correct as it is, and say so in your report.',
  )
  if (accept.length > 0) {
    lines.push(
      '- A finding you confirmed is a false positive goes in its tool\'s own suppression file, one at a time, through the command above — never through the tool\'s own baseline command.',
    )
  }
  lines.push(
    '- SkillHone workflows may use bypass mode and local subprocess execution. Run them only in a workspace you are willing to lose.',
  )
  lines.push('- Nothing here has been applied. SkillGantry does not run the optimiser; you do.', '')

  lines.push(...verifySection(skill.id, ['validate', 'evaluate', 'security']), '')

  lines.push('## Report back', '')
  lines.push(
    'What you changed and why, the evaluate result before and after, and one line per finding with the judgement you reached.',
  )

  return `${lines.join('\n')}\n`
}
