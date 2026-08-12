import { join } from 'node:path'
import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/index.js'

/**
 * A synthetic `SkillRef` for the screen suites, which render skills they never
 * discover. Shared rather than declared per suite: `SkillRef` gains fields, and
 * a second literal is the one the compiler updates while the assertions keep
 * reading the stale shape.
 */
export const skillRef = (
  id: string,
  over: Partial<SkillRef> & { isGit?: boolean } = {},
): SkillRef => {
  const { isGit = false, ...rest } = over
  return {
    id,
    name: id,
    version: '1.0.0',
    dir: `/repo/${id}`,
    relPath: id,
    repo: { id: 'fx', path: '/repo', name: 'fx', isGit },
    rootSkill: false,
    frontmatterReadable: true,
    workspacePath: `/repo/${id}-workspace`,
    deprecated: false,
    supersededBy: null,
    ...rest,
  }
}

/**
 * The skill the adapter fixtures were captured against: the `zapac` skills repo
 * as it stood when `capture-fixtures.sh` ran. `version` is null because those
 * skills declare none, and the tool input under assertion is built from it.
 */
export const zapacSkill = (relPath: string): SkillRef =>
  skillRef(`zapac/${relPath}`, {
    name: relPath,
    version: null,
    dir: `/tmp/zapac/${relPath}`,
    relPath,
    repo: { id: 'zapac', path: '/tmp/zapac', name: 'zapac', isGit: true },
    workspacePath: `/tmp/zapac/${relPath}-workspace`,
  })

/**
 * The same skill for a suite that has a real repo on disk. Every path derives
 * from the fixture's own repo path, and `workspacePath` comes from the function
 * production uses — the sidecar layout is what these suites assert against, so
 * a hand-written `${dir}-workspace` is the literal that goes stale silently.
 * `relPath` of `.` is the repo-root skill, whose id carries no skill segment.
 */
export const repoSkillRef = (
  repoPath: string,
  relPath = 'sk',
  over: Partial<SkillRef> & { isGit?: boolean } = {},
): SkillRef => {
  const rootSkill = relPath === '.'
  return skillRef(rootSkill ? 'repo' : `repo/${relPath}`, {
    name: rootSkill ? 'root' : relPath,
    dir: rootSkill ? repoPath : join(repoPath, relPath),
    relPath,
    rootSkill,
    repo: { id: 'repo', path: repoPath, name: 'repo', isGit: over.isGit ?? false },
    workspacePath: workspacePath(repoPath, relPath, rootSkill),
    ...over,
  })
}
