import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillRef } from '../core/types.js'

/**
 * One definition of what an eval asset is, shared by `optimise` and `evals`.
 * Two lists is how the two prompts come to disagree about what a skill carries.
 */
const EVAL_CANDIDATES = ['evals/eval.yaml', 'evals/cases', 'evals']

/** The file the evaluate stage's argv names, and the only one it will read. */
const SUITE = 'evals/eval.yaml'

/** Absent is the common case, so a missing path is data rather than an error. */
export async function evalAssetsOf(skill: SkillRef): Promise<string[]> {
  const found: string[] = []
  for (const rel of EVAL_CANDIDATES) {
    try {
      await access(join(skill.dir, rel))
      found.push(join(skill.relPath, rel))
    } catch {
      // not carried by this skill
    }
  }
  return found
}

/**
 * The suite specifically, not the directory: `evals/` holding cases and no
 * `eval.yaml` is a skill the gate still cannot run, and treating the directory
 * as the test would send that skill into a run that errors.
 */
export async function hasEvalSuite(skill: SkillRef): Promise<boolean> {
  try {
    await access(join(skill.dir, SUITE))
    return true
  } catch {
    return false
  }
}
