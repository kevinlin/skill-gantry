import { access, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillRef } from '../core/types.js'

/** The file the evaluate stage's argv names, and the only one it will read. */
const SUITE = 'evals/eval.yaml'

/** Where a failing case's issue path points, so where the cases live. */
const CASES = 'evals/cases'

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * One definition of what an eval asset is, shared by `optimise` and `evals`.
 * Two lists is how the two prompts come to disagree about what a skill carries.
 *
 * Two entries at most, and never a bare directory: a path in this list reads as
 * something an agent can open, and `evals` or `evals/cases` alone is one it
 * would try to. The cases are a count instead, because their names are the
 * agent's to discover and a listing of them would grow with the suite.
 *
 * Absent is the common case, so a missing path is data rather than an error.
 */
export async function evalAssetsOf(skill: SkillRef): Promise<string[]> {
  const found: string[] = []
  if (await isFile(join(skill.dir, SUITE))) found.push(join(skill.relPath, SUITE))

  try {
    const entries = await readdir(join(skill.dir, CASES), { withFileTypes: true })
    const files = entries.filter((entry) => entry.isFile()).length
    found.push(`${join(skill.relPath, CASES)}/ (${files} file${files === 1 ? '' : 's'})`)
  } catch {
    // no cases directory, or `evals/cases` is a file: not carried by this skill
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
