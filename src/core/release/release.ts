import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { MutationSandbox } from '../isolation/types.js'
import type { MutationScope } from '../stages/types.js'
import type { SkillRef } from '../types.js'
import { prependChangelogEntry } from './changelog.js'
import { setFrontmatterVersion } from './frontmatter-edit.js'
import { type VersionsManifest, setManifestVersion } from './manifest.js'

export type ManifestMode = 'versions.json' | 'none'

/** The archive's key in versions.json is the skill's directory name. */
export const manifestKeyFor = (skill: SkillRef): string =>
  skill.rootSkill ? (skill.name ?? basename(skill.repo.path)) : basename(skill.relPath)

/**
 * R10.1: the scope may reach outside the skill directory, which is exactly why
 * revision 1's skill-scoped sandbox could not express a release. The archive is
 * in scope because R9.4 makes it an output that must be previewed, journalled
 * and removed by a rollback like any other.
 */
export function releaseScope(
  skill: SkillRef,
  hasManifest: boolean,
  archiveName: string,
): MutationScope {
  const prefix = skill.relPath === '.' ? '' : `${skill.relPath}/`
  return {
    paths: [
      `${prefix}SKILL.md`,
      `${prefix}CHANGELOG.md`,
      archiveName,
      ...(hasManifest ? ['versions.json'] : []),
    ],
  }
}

export interface StageEditsInput {
  sandbox: MutationSandbox
  skill: SkillRef
  version: string
  /** ISO date, injected so the state machine stays testable. */
  date: string
  notes?: string
  /**
   * The manifest itself, not a boolean flag. R9.1's "never creates
   * versions.json" would otherwise depend on every caller re-deriving the
   * right boolean from `readVersionsManifest`'s result and passing it through
   * correctly — a convention, not a guarantee. Requiring the object makes the
   * only way to reach `setManifestVersion` be already holding the value
   * `readVersionsManifest` returned, so a caller that never read it, or read
   * it and got `null`, has nothing to pass that would trigger the write.
   */
  manifest: VersionsManifest | null
}

/**
 * All three writes land inside the sandbox; nothing here can reach the live
 * tree. Reports which path was taken so the caller can record it in the
 * evidence bundle without re-deriving it from `input.manifest` a second time.
 */
export async function stageCandidateEdits(
  input: StageEditsInput,
): Promise<{ manifestMode: ManifestMode }> {
  const prefix = input.skill.relPath === '.' ? '' : `${input.skill.relPath}/`

  const skillMdPath = input.sandbox.resolve(`${prefix}SKILL.md`)
  await writeFile(
    skillMdPath,
    setFrontmatterVersion(await readFile(skillMdPath, 'utf8'), input.version),
  )

  const changelogPath = input.sandbox.resolve(`${prefix}CHANGELOG.md`)
  const existing = await readFile(changelogPath, 'utf8').catch(() => '')
  await mkdir(dirname(changelogPath), { recursive: true })
  await writeFile(
    changelogPath,
    prependChangelogEntry(existing, input.version, input.date, input.notes),
  )

  if (input.manifest === null) return { manifestMode: 'none' }
  const manifestPath = input.sandbox.resolve('versions.json')
  await writeFile(
    manifestPath,
    setManifestVersion(
      await readFile(manifestPath, 'utf8'),
      manifestKeyFor(input.skill),
      input.version,
    ),
  )
  return { manifestMode: 'versions.json' }
}
