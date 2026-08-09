import type { BaselineSpec } from '../adapters/types.js'

/**
 * The finding vocabulary. Kept separate from `invoke.argv`'s path vocabulary
 * so a `{skillDir}` cannot leak into an entry field, or a `{reason}` into a
 * path — two vocabularies in one substituter is how a token comes to mean
 * something in a position it was never defined for.
 */
export interface FindingVars {
  nativeRuleId: string
  /** Skill-relative: the tool globs against the path it reported, not ours. */
  skillRelativePath: string
  reason: string
}

/**
 * fnmatch metacharacters, each escaped as a single-member character class.
 * `]` is not one of them: it only terminates a class that is open, and every
 * `[` is escaped here, so no class is ever open when one is reached. Escaping
 * it anyway turns `notes[1].md` into `notes[[]1[]].md`, which is a pattern for
 * a filename that has no `]` in it.
 */
export const globEscape = (value: string): string => value.replace(/[*?[]/g, (ch) => `[${ch}]`)

/**
 * R4.16's path trap. `RawFinding.path` is repo-relative because §7.1 rebases
 * every reported path onto `skillRelPath`; the tool's own baseline globs
 * against the path the tool reported, which is skill-relative. The prefix test
 * carries the separator so a sibling directory sharing the skill's name is not
 * mistaken for the skill.
 */
export function skillRelative(repoRelPath: string, skillRelPath: string): string {
  if (skillRelPath === '.') return repoRelPath
  const prefix = `${skillRelPath}/`
  return repoRelPath.startsWith(prefix) ? repoRelPath.slice(prefix.length) : repoRelPath
}

const TOKENS: Readonly<Record<string, (vars: FindingVars) => string>> = {
  nativeRuleId: (vars) => vars.nativeRuleId,
  ruleIdGlob: (vars) => globEscape(vars.nativeRuleId),
  skillRelativePath: (vars) => vars.skillRelativePath,
  pathGlob: (vars) => globEscape(vars.skillRelativePath),
  reason: (vars) => vars.reason,
}

/** One accepted finding, in the shape the manifest declared. */
export function suppressionEntry(spec: BaselineSpec, vars: FindingVars): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, template] of Object.entries(spec.entry)) {
    out[key] = template.replace(/\{(\w+)\}/g, (_whole, token: string) => {
      const resolve = TOKENS[token]
      // Thrown rather than left literal: a `{typo}` written into a user's repo
      // is a rule that never matches and never explains itself.
      if (resolve === undefined) throw new Error(`unknown suppression token: {${token}}`)
      return resolve(vars)
    })
  }
  return out
}
