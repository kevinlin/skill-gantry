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
