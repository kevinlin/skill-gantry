import type { SkillRef, Stage } from '../types.js'
import { actionableFindings } from './outcome.js'
import type { StageResult } from './types.js'

export interface OptimisePromptInput {
  /**
   * The user's real skill, never `ctx.skill` — §9.4's rule. There is no run in
   * flight here, but the rule is the same one: the prompt names where an agent
   * should edit, and a sandbox path does not survive to be edited.
   */
  skill: SkillRef
  lastRun: {
    runId: string
    runDir: string
    skillDigest: string
    git: { commit: string | null; dirty: boolean }
    stages: Array<{ stage: Stage; result: StageResult }>
  } | null
  /** Repo-relative paths that exist under `<skill>/evals/`. */
  evalAssets: readonly string[]
  /**
   * Plain fields rather than a type from `tools`, so this module adds no §3
   * edge — the property §9.4 records as the reason `fix-prompt.ts` lives here.
   */
  install: { interpreter: string; skillsDir: string; sha: string; missing: readonly string[] }
}

/** A message goes into a markdown table cell, so its two breaking characters go. */
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

/**
 * R6.12. Returns a string always, unlike `buildFixPrompt`'s nullable return:
 * the trigger here is a user keystroke rather than a findings count, so a
 * refusal is a flash rather than an absent document.
 */
export function buildOptimisePrompt(input: OptimisePromptInput): string {
  const { skill, lastRun, install } = input
  const lines: string[] = [`# Optimise: ${skill.name}`, '']

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
  if (lastRun === null) {
    // Stated rather than omitted: a section that vanishes reads as a builder
    // that failed rather than as a skill that has not run.
    lines.push('There is no recorded run for this skill yet.', '')
  } else {
    lines.push(
      `Run \`${lastRun.runId}\` · digest \`${lastRun.skillDigest}\` · ` +
        `commit \`${lastRun.git.commit ?? 'none'}\`${lastRun.git.dirty ? ' (dirty)' : ''}`,
      '',
    )
    let suppressed = 0
    for (const { stage, result } of lastRun.stages) {
      lines.push(`### ${stage} — \`${result.outcome}\``, '')
      const all = result.toolRuns.flatMap((run) => run.findings)
      suppressed += all.length - actionableFindings(all).length
      for (const run of result.toolRuns) {
        // §9.4's rule: name the report, do not restate it. `RawFinding` is a
        // closed six-field record, so remediation and explanation are only ever
        // in the tool's own artefacts.
        lines.push(`- **${run.toolId}** \`${run.outcome}\` — report: \`${run.artefactDir}\``)
      }
      const findings = actionableFindings(all)
      if (findings.length > 0) {
        lines.push('', '| severity | rule class | location | message |', '|---|---|---|---|')
        for (const finding of findings) {
          lines.push(
            `| ${finding.severity} | ${finding.ruleClass} | ${cell(finding.path)} | ${cell(finding.message)} |`,
          )
        }
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

  lines.push('## Task', '')
  lines.push(
    `Use the \`skillhone\` skill to optimise the skill at \`${skill.dir}\`. ` +
      'It dispatches to its own sub-skills; read its SKILL.md before choosing one.',
    '',
  )
  lines.push('## Constraints', '')
  lines.push(
    "- Never write under `*-workspace/` or `.skillgantry-workspace/` — that is SkillGantry's evidence, including the reports named above.",
  )
  lines.push(
    '- Judge each finding before changing anything, and stop and report rather than edit code you judge correct.',
  )
  lines.push(
    '- SkillHone workflows may use bypass mode and local subprocess execution. Run them only in a workspace you are willing to lose.',
  )
  lines.push('- Nothing here has been applied. SkillGantry does not run the optimiser (R6.12).')

  return `${lines.join('\n')}\n`
}
