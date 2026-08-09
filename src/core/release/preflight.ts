import { previewDirtyPaths } from '../isolation/open.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'
import { readVersionsManifest } from './manifest.js'
import { releaseScope } from './release.js'

/**
 * What a release would refuse on before it is asked for — R10.3's uncommitted
 * scope paths, named so a frontend can offer the override with the paths on
 * screen rather than as a blind toggle.
 *
 * It answers the question `openSandbox` will answer again at run time, and it
 * is not the authority: the tree can change between this call and the stage,
 * which is the same reason `ReleaseStageExecutor.execute` re-derives the
 * manifest mode instead of trusting `plan()`. A frontend showing this is
 * previewing, never deciding.
 *
 * The archive is deliberately absent from the scope. `releaseScope` includes
 * `<skillName>_<version>.zip`, and the version is precisely what has not been
 * supplied yet — so a stray archive from a crashed release is not reported
 * here and is still caught by `openSandbox`, which is where the decision lives.
 */
export async function releaseDirtyPaths(
  skill: SkillRef,
  exec: Exec = defaultExec,
): Promise<string[]> {
  const manifest = await readVersionsManifest(skill.repo.path)
  return previewDirtyPaths(skill, releaseScope(skill, manifest !== null, null).paths, exec)
}
