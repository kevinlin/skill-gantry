import { workspacePath } from '../../src/core/discovery/discover.js'
import type { SkillRef } from '../../src/core/types.js'

export function skillFixture(repoId: string, name: string): SkillRef {
  return {
    id: `${repoId}/${name}`,
    name,
    version: '1.0.0',
    dir: `/${repoId}/${name}`,
    relPath: name,
    repo: { id: repoId, path: `/${repoId}`, name: repoId, isGit: false },
    rootSkill: false,
    workspacePath: workspacePath(`/${repoId}`, name, false),
    deprecated: false,
    supersededBy: null,
  }
}
