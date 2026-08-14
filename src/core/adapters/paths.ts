import type { SkillRef } from '../types.js'

/**
 * A tool reports paths relative to the directory it was pointed at, which is
 * the candidate root, not the repo root. Scanning `declawed` yields `SKILL.md`
 * and `scripts/scan.py`; R8.3 wants `declawed/SKILL.md`. Rebasing here rather
 * than per parser is also what makes a materialised candidate and an in-place
 * one produce identical findings.
 */
export function rebasePath(skillRelPath: string, uri: string): string {
  const normalised = uri.replace(/\\/g, '/').replace(/^\.\//, '')
  if (skillRelPath === '.' || skillRelPath === '') return normalised
  if (normalised === '') return skillRelPath
  return `${skillRelPath}/${normalised}`
}

/**
 * `BaselineSpec.path`'s `{skillDir}`/`{repoRoot}` vocabulary, resolved beside
 * the spec that defines it rather than at each reader. The write path and the
 * prompts that name the file both resolve it, and a second substituter is how
 * one of them comes to print a literal `{token}` at the agent it is instructing
 * while the other writes the real file.
 *
 * The template rather than the whole `BaselineSpec`, so a prompt holding only
 * the manifest fields it reads can call it without widening to a shape it never
 * consults.
 *
 * Resolved against the **live** skill directory, deliberately unlike §7's
 * conditional-argv stat, which resolves against the tool-facing path. A
 * repo-root skill's tool reads a materialised candidate copy (§4.4), so a write
 * resolved the tool's way would land in a temp directory and be discarded with
 * it. Same token, opposite answer, and it reads as a bug without this note.
 */
export function resolveBaselinePath(skill: SkillRef, template: string): string {
  return template.replace(/\{(skillDir|repoRoot)\}/g, (_m, key: string) =>
    key === 'skillDir' ? skill.dir : skill.repo.path,
  )
}
