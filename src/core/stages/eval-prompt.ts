import { join } from 'node:path'
import { getAdapter } from '../adapters/registry.js'
import type { SkillRef } from '../types.js'

export interface EvalPromptInput {
  /**
   * The user's real skill, never `ctx.skill` — §9.4's rule. There is no run in
   * flight here at all, but the rule is the same one: the prompt names where an
   * agent should write, and a sandbox path does not survive to be written to.
   */
  skill: SkillRef
  /** Repo-relative paths that exist under `<skill>/evals/`. */
  evalAssets: readonly string[]
  /** `evals/eval.yaml` specifically — the file the stage's argv names. */
  hasSuite: boolean
  /**
   * Plain fields rather than a type from `tools`, so this module adds no §3
   * edge — the property §9.4 records as the reason `fix-prompt.ts` lives here.
   */
  install: {
    /** The locked skill-up binary. */
    runner: string
    /** Its pin, which is also skill-upper's — one upstream project, one pin. */
    pin: string
    /** Where the agent can read skill-upper's own SKILL.md and templates. */
    authoringSkillDir: string
    missing: readonly string[]
  }
  /** Injectable so a test need not register an adapter. */
  lookup?: typeof getAdapter
}

/** The evaluate stage's own tool, whose argv is what fixes the suite's path. */
const RUNNER_ID = 'skill-up'

/**
 * Named, never read. skill-upper's step 5 stops and asks the user for one of
 * these rather than writing a secret into YAML, which is the correct behaviour
 * — so SkillGantry's job is to say which key is wanted and leave the asking
 * where it is. R7.3 is why no value can reach this module: it takes none.
 */
const CREDENTIAL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'QODER_PERSONAL_ACCESS_TOKEN']

/**
 * The same credential in the shape a gateway user holds it. Naming only the
 * three above described a machine SkillGantry does not require: an Anthropic
 * credential reaches a spawned tool as this pair as often as it does as
 * `ANTHROPIC_API_KEY`, `spawnEnv` derives one form from the other, and the
 * setup wizard already reports the token by this name. Keys, never values.
 */
const GATEWAY_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']

/**
 * The stage's real argv with its two substitutions resolved, so the agent reads
 * the command that will actually run rather than a hand-written approximation
 * of it. Read from the manifest for §9.4's reason: a pin bump moves the prompt
 * with it, and a literal here would describe the previous release forever.
 */
function invocation(skill: SkillRef, lookup: typeof getAdapter): string | null {
  const manifest = lookup(RUNNER_ID)?.manifest
  if (!manifest) return null
  const argv = manifest.invoke.argv.map((token) =>
    token.replace('{skillDir}', skill.dir).replace('{toolDir}', '<the run’s tool directory>'),
  )
  return `${RUNNER_ID} ${argv.join(' ')}`
}

/**
 * R6.13. Returns a string always, `buildOptimisePrompt`'s rule and for its
 * reason: the trigger is a keystroke rather than a findings count, so a refusal
 * is a flash rather than an absent document.
 */
export function buildEvalPrompt(input: EvalPromptInput): string {
  const { skill, install } = input
  const lookup = input.lookup ?? getAdapter
  const manifest = lookup(RUNNER_ID)?.manifest
  const suitePath = join(skill.dir, 'evals', 'eval.yaml')

  const lines: string[] = [
    `# ${input.hasSuite ? 'Extend' : 'Author'} the eval suite for ${skill.name}`,
    '',
  ]

  lines.push(`- Skill directory: \`${skill.dir}\``)
  lines.push(`- Repo root: \`${skill.repo.path}\``)
  lines.push(`- Skill definition: \`${join(skill.dir, 'SKILL.md')}\``)
  lines.push(`- Declared version: ${skill.version ?? 'none'}`)
  lines.push(`- Eval runner: \`${install.runner}\` at \`${install.pin}\``)
  lines.push(`- Authoring skill: \`${install.authoringSkillDir}\``)
  if (input.evalAssets.length > 0) {
    lines.push(`- Eval assets present: ${input.evalAssets.map((p) => `\`${p}\``).join(', ')}`)
  } else {
    // Stated rather than omitted: a section that vanishes reads as a builder
    // that failed rather than as a skill that carries nothing.
    lines.push('- Eval assets present: none under `evals/`')
  }
  const argv = invocation(skill, lookup)
  if (argv !== null) {
    lines.push(`- The evaluate gate runs: \`${argv}\``)
    const artefact = manifest?.artefacts[0]
    if (artefact !== undefined) lines.push(`- and reads \`${artefact}\` from that directory`)
  }
  lines.push('')

  if (install.missing.length > 0) {
    // Before the task, never after — §9.4a's rule and its reason: a prompt
    // describing work that cannot start fails inside the agent's session
    // rather than in the terminal that produced it.
    lines.push(`> Missing: ${install.missing.join(', ')}. Resolve these first.`, '')
  }

  lines.push('## Task', '')
  lines.push(
    `1. Read \`${join(install.authoringSkillDir, 'SKILL.md')}\` first. It owns the eval templates ` +
      '(`assets/eval.yaml.tmpl`, `assets/case.yaml.tmpl`) and the judge guidance this task needs.',
  )
  lines.push(
    `2. Read \`${join(skill.dir, 'SKILL.md')}\` and decide what this skill claims to do. One ` +
      'behaviour it claims is one case.',
  )
  lines.push(
    input.hasSuite
      ? `3. Extend \`${suitePath}\`, adding a case per uncovered behaviour under \`${join(skill.dir, 'evals', 'cases')}/<case-id>.yaml\`.`
      : `3. Write \`${suitePath}\` from the template, and one case per behaviour at \`${join(skill.dir, 'evals', 'cases')}/<case-id>.yaml\`.`,
  )
  lines.push(`4. Validate with \`${RUNNER_ID} validate ${suitePath}\` and fix what it reports.`)
  lines.push(
    '5. Stop and report what you wrote and what you deliberately left uncovered. Do not run the ' +
      'suite — SkillGantry runs it as the evaluate gate.',
  )
  lines.push('')

  lines.push('## Constraints', '')
  // Each names why it is fixed, because a constraint whose reason is not on the
  // page is one an agent talks itself out of.
  lines.push(
    `- The suite goes at \`${suitePath}\` and nowhere else. The evaluate gate's argv names that ` +
      'exact path, so a suite anywhere else is invisible to it.',
  )
  lines.push(
    `- Cases go at \`${join(skill.dir, 'evals', 'cases')}/<case-id>.yaml\`. A failing case is ` +
      'filed as an issue pathed at that file, so a case stored elsewhere produces an issue ' +
      'naming a file that does not exist.',
  )
  lines.push(
    '- Keep the report format JSON. The gate parses skill-up’s `v1alpha1` report; another format ' +
      'reaches the parser as an unreadable artefact.',
  )
  lines.push(
    '- Prefer `rule_based` assertions to `agent_judge` wherever a behaviour admits one. This ' +
      'suite runs on every evaluate gate, and an LLM judge makes every gate a billed, ' +
      'non-deterministic call.',
  )
  lines.push(
    `- Add files under \`evals/\` only. Do not edit anything the skill ships — adding evals is ` +
      'not fixing a skill, and a skill fix is a separate prompt.',
  )
  lines.push(
    "- Never write under `*-workspace/` or `.skillgantry-workspace/`. That is SkillGantry's " +
      'evidence.',
  )
  lines.push(
    `- The engine is declared by the suite itself and authenticated by that CLI. If it wants a ` +
      `credential, it will ask for one of ${CREDENTIAL_KEYS.map((key) => `\`${key}\``).join(', ')}, ` +
      `or, against a gateway, the pair ${GATEWAY_KEYS.map((key) => `\`${key}\``).join(' and ')}. ` +
      'Ask the user; never write a key into a YAML file.',
  )
  lines.push(
    '- SkillGantry has authored none of this and will run none of it (R6.13). Everything here is ' +
      'yours to write.',
  )

  return `${lines.join('\n')}\n`
}
