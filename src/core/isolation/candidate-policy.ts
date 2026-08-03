import { type CandidateEntry, candidateManifest } from '../discovery/candidate.js'
import type { SkillRef } from '../types.js'

/**
 * What `candidateManifest` allows for one skill, reshaped for scope handling:
 * repo-root-relative paths (scope's own coordinate system) mapped to the
 * entry the manifest walk found there. Building this calls the manifest's
 * own walk, so a symlink inside the candidate root that escapes it throws
 * `candidate-escapes-root` here too — R2.10 is enforced once, in the one
 * place that already enforces it for every other consumer, not re-derived.
 *
 * Shared by both sandbox strategies rather than living in one of them: the
 * git strategy needs it for R10.3's dirty check (which spans the candidate,
 * not just the scope) and the snapshot strategy needs it for the copy and the
 * restore. Two copies of "which bytes are a skill" is exactly what design
 * §4.4 forbids.
 */
export interface CandidatePolicy {
  /** Repo-root-relative candidate root; '' for a repo-root skill. */
  root: string
  allowed: Map<string, CandidateEntry>
}

export async function candidatePolicyFor(skill: SkillRef): Promise<CandidatePolicy> {
  const manifest = await candidateManifest(skill)
  const root = skill.relPath === '.' ? '' : skill.relPath
  const allowed = new Map<string, CandidateEntry>()
  for (const entry of manifest.entries) {
    allowed.set(root === '' ? entry.relPath : `${root}/${entry.relPath}`, entry)
  }
  return { root, allowed }
}

export const underCandidateRoot = (relPath: string, root: string): boolean =>
  root === '' || relPath === root || relPath.startsWith(`${root}/`)

/**
 * True when `relPath` is a directory the manifest has entries beneath. A scope
 * or status path can name a directory (`git status -z` reports a wholly
 * untracked directory as `foo/`), and such a path is part of the candidate even
 * though the manifest, which lists files, holds no entry for it.
 */
export const containsAllowed = (policy: CandidatePolicy, relPath: string): boolean => {
  const prefix = relPath === '.' || relPath === '' ? '' : `${relPath}/`
  for (const rel of policy.allowed.keys()) if (rel.startsWith(prefix)) return true
  return false
}
