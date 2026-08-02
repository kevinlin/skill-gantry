import { createHash } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type CandidateManifest, materialiseCandidate } from '../discovery/candidate.js'
import { type Exec, defaultExec } from '../tools/exec.js'

export interface PackageInput {
  manifest: CandidateManifest
  /** `<run>/staging` — outside the candidate root, which is why the archive
   *  cannot contain itself. */
  stagingDir: string
  skillName: string
  version: string
  exec?: Exec
}

/**
 * A large skill would otherwise overflow argv. The reference repo's biggest
 * skill is well under this; the batch loop exists so a pathological one degrades
 * into several `zip` calls rather than an E2BIG nobody can act on.
 */
const ENTRIES_PER_CALL = 500

/**
 * R9.4: the archive holds exactly the candidate manifest. The entry list is not
 * an optimisation — `zip -r <dir>` adds directory entries the manifest does not
 * have, so passing names is what makes the archive equal to the digested set.
 *
 * `-y` stores symlinks as links (R2.10 holds in every consumer of the manifest);
 * `-X` drops extra attributes. The archive is still not byte-reproducible,
 * because zip embeds mtimes: the skill digest is the reproducible identity and
 * this SHA-256 is evidence of one build.
 */
export async function packageCandidate(
  input: PackageInput,
): Promise<{ archivePath: string; sha256: string; entries: string[] }> {
  const exec = input.exec ?? defaultExec
  await mkdir(input.stagingDir, { recursive: true })

  // Materialise first: the manifest already excludes the workspace, the git
  // directory and any earlier archive, and copying it means `zip` is pointed at
  // a tree that contains nothing else to get wrong.
  const contentRoot = join(input.stagingDir, 'content')
  await rm(contentRoot, { recursive: true, force: true })
  await mkdir(contentRoot, { recursive: true })
  await materialiseCandidate(input.manifest, contentRoot)

  const archivePath = join(input.stagingDir, `${input.skillName}_${input.version}.zip`)
  await rm(archivePath, { force: true })

  const entries = input.manifest.entries.map((entry) => entry.relPath)
  for (let i = 0; i < entries.length; i += ENTRIES_PER_CALL) {
    await exec('zip', ['-X', '-y', '-q', archivePath, ...entries.slice(i, i + ENTRIES_PER_CALL)], {
      cwd: contentRoot,
      timeoutMs: 300_000,
    })
  }

  const bytes = await readFile(archivePath)
  return { archivePath, sha256: createHash('sha256').update(bytes).digest('hex'), entries }
}
