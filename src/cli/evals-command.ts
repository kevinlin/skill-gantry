import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  SKILL_UPPER_TOOL_ID,
  SKILL_UP_TOOL_ID,
  buildEvalPrompt,
  catalogueEntry,
  defaultExec,
  detectSkillDirs,
  loadToolLock,
} from '../core/index.js'
import type { SkillRef } from '../core/types.js'
import { selectSkill, type CliDeps } from './run-command.js'
import { evalAssetsOf, hasEvalSuite } from './skill-evals.js'

export interface EvalPlan {
  skill: SkillRef
  prompt: string
  /** `evals/eval.yaml` specifically — what the pre-flight branches on. */
  hasSuite: boolean
  missing: readonly string[]
}

/**
 * The one assembly, shared by the port and the subcommand, so the pane and the
 * headless output can never disagree about what was handed over —
 * `planOptimiseFor`'s rule and for its reason.
 */
export async function planEvalsFor(
  home: string,
  skill: SkillRef,
  userHome: string = homedir(),
): Promise<EvalPlan> {
  const lock = await loadToolLock(home)
  const runner = lock.tools[SKILL_UP_TOOL_ID]
  if (runner === undefined) {
    throw new Error(`${SKILL_UP_TOOL_ID} is not installed — run \`skillgantry setup\``)
  }

  // Reachability, not a lock lookup: a foreign copy is still a copy the agent
  // can load, which is the same fact doctor reports as `skill-link-unmanaged`
  // and declines to fail on.
  const spec = catalogueEntry(SKILL_UPPER_TOOL_ID)?.install
  if (spec?.kind !== 'git-skill') throw new Error(`${SKILL_UPPER_TOOL_ID} is not in the catalogue`)
  const dirs = await detectSkillDirs(userHome, spec)
  const held = dirs.find((entry) => entry.holds)
  if (held === undefined) {
    throw new Error(
      `${SKILL_UPPER_TOOL_ID} is not reachable from any agent runtime — run \`skillgantry setup\``,
    )
  }

  const missing: string[] = []
  try {
    await access(runner.bin)
  } catch {
    missing.push('the locked skill-up binary')
  }
  try {
    // §5.3's own probe. The engine every reference suite declares is
    // `claude_code`, and claude-agent-sdk shells out to this CLI, so its
    // absence surfaces at the suite's first run rather than at install.
    await defaultExec('command', ['-v', 'claude'])
  } catch {
    missing.push('the `claude` CLI (npm install -g @anthropic-ai/claude-code)')
  }

  const hasSuite = await hasEvalSuite(skill)
  const prompt = buildEvalPrompt({
    skill,
    evalAssets: await evalAssetsOf(skill),
    hasSuite,
    install: {
      runner: runner.bin,
      pin: runner.resolvedVersion,
      // The link the runtime holds, which is the path a maintainer will
      // recognise and the one an agent can actually read.
      authoringSkillDir: `${held.dir}/${SKILL_UPPER_TOOL_ID}`,
      missing,
    },
  })
  return { skill, prompt, hasSuite, missing }
}

export interface EvalsOptions {
  json?: boolean
}

export async function runEvals(
  deps: CliDeps,
  selector: string,
  opts: EvalsOptions,
  /** Injected for the reason `DoctorInput.userHome` is: a test points the
      runtime-directory probe at a temp home rather than the real one. */
  userHome: string = homedir(),
): Promise<number> {
  const { skill } = await selectSkill(deps.home, selector)
  let plan: EvalPlan
  try {
    plan = await planEvalsFor(deps.home, skill, userHome)
  } catch (err) {
    deps.write(`${(err as Error).message}\n`)
    // `fix`'s and `optimise`'s divergence from R12.2: the exit code answers
    // "is there a prompt on stdout", so a clean skill and a missing tool stay
    // distinguishable.
    return 2
  }
  deps.write(opts.json === true ? `${JSON.stringify(plan, null, 2)}\n` : plan.prompt)
  return 0
}
