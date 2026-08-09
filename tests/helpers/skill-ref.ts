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
    workspacePath: `/repo/${id}-workspace`,
    deprecated: false,
    supersededBy: null,
    ...rest,
  }
}
