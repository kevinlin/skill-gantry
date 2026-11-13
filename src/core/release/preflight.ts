import { previewDirtyPaths } from '../isolation/open.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'
import { readVersionsManifest } from './manifest.js'
import { archiveNameFor, releaseScope } from './release.js'

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
 * The archive is in the scope only when `version` is supplied. Its name embeds
 * the target version, so a caller that has none yet cannot ask about it, and a
 * stray archive from a crashed release is then left for `openSandbox`, which is
 * where the decision lives. A caller that has resolved a target passes it, and
 * the archive that target names is previewed beside every other scope path —
 * which is how `status --version` reports it as uncommitted rather than as a
 * refusal. `version` must be the *resolved* semver: a bump level would name a
 * file no release ever writes.
 */
export async function releaseDirtyPaths(
  skill: SkillRef,
  exec: Exec = defaultExec,
  version?: string,
): Promise<string[]> {
  const manifest = await readVersionsManifest(skill.repo.path)
  const archiveName = version === undefined ? null : archiveNameFor(skill, version)
  return previewDirtyPaths(skill, releaseScope(skill, manifest !== null, archiveName).paths, exec)
}
