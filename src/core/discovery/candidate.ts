import { copyFile, chmod, lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { SkillRef } from '../types.js'

export type CandidateEntry =
  | { kind: 'file'; relPath: string; exec: boolean }
  | { kind: 'symlink'; relPath: string; target: string }

export interface CandidateManifest {
  root: string
  entries: CandidateEntry[]
  /** False when the root would otherwise hold SkillGantry-owned paths. */
  selfContained: boolean
}

const posix = (p: string): string => p.split(sep).join('/')

/**
 * Where `src/core/suppress/write.ts` stages its bytes. Same-directory rename is
 * the only portable atomic recipe, so the file lands inside the candidate root
 * — and an exact SkillGantry-owned path is what R2.9 allows to be excluded.
 * Release solved the same problem the same way for `<skillName>_*.zip`.
 */
export const WRITE_TEMP_NAME = '.skillgantry-write.tmp'

/**
 * Filesystem droppings no skill authored and no consumer should receive,
 * matched by basename at any depth. This is the one basename rule, and it is
 * narrow on purpose: these names are reserved by the operating system, so no
 * legitimate skill file carries them — which is exactly what was untrue of
 * revision 2's `snapshot-pre` directory match.
 *
 * They are excluded rather than tolerated because a candidate file that git
 * ignores cannot be reproduced in a git sandbox from `git status` alone, so it
 * made §4.4's "the bytes gated, snapshotted and packaged are the same set" a
 * promise the git strategy could not keep: the digest counted a `.DS_Store` the
 * worktree never had, R9.9 refused the release, and re-running the gates
 * reproduced the same disagreement. Run `019fe590` is that refusal on disk.
 * `git-worktree.ts` fixes the general case; this stops the commonest instance
 * of it being a released byte.
 */
const NOISE_BASENAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db'])

/**
 * Exact owned paths, resolved against the candidate root. Deliberately not a
 * basename match: revision 2 excluded any directory called `snapshot-pre`,
 * which let a legitimately named skill directory change without invalidating
 * the gate evidence bound to its digest.
 */
function excludedPaths(skill: SkillRef): Set<string> {
  const owned = new Set<string>([
    posix(relative(skill.dir, skill.workspacePath)),
    '.git',
    // Unguarded by `rootSkill`, unlike `.gitignore` below: the suppression
    // write happens in whichever candidate root holds the baseline.
    WRITE_TEMP_NAME,
  ])
  if (skill.rootSkill) owned.add('.gitignore')
  return owned
}

const isReleaseArchive = (skill: SkillRef, rel: string): boolean =>
  skill.rootSkill && /^[^/]+_[^/]*\.zip$/.test(rel)

export async function candidateManifest(skill: SkillRef): Promise<CandidateManifest> {
  const excluded = excludedPaths(skill)
  const entries: CandidateEntry[] = []

  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name)
      const rel = posix(relative(skill.dir, abs))
      if (excluded.has(rel) || isReleaseArchive(skill, rel) || NOISE_BASENAMES.has(e.name)) continue

      if (e.isSymbolicLink()) {
        const target = await readlink(abs)
        const resolved = resolve(dirname(abs), target)
        const inside = resolved === skill.dir || resolved.startsWith(skill.dir + sep)
        if (!inside) {
          throw new Error(`candidate-escapes-root: ${rel} -> ${target}`)
        }
        entries.push({ kind: 'symlink', relPath: rel, target })
      } else if (e.isDirectory()) {
        await walk(abs)
      } else if (e.isFile()) {
        // lstat, not stat: a mode must describe the entry itself, never a target.
        const info = await lstat(abs)
        entries.push({ kind: 'file', relPath: rel, exec: (info.mode & 0o111) !== 0 })
      }
    }
  }
  await walk(skill.dir)

  // Codepoint order, not localeCompare: the digest hashes entries in this order,
  // so a locale-sensitive collation would digest one skill differently per machine.
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))

  return {
    root: skill.dir,
    entries,
    // A repo-root skill keeps its workspace, gitignore and archives inside the
    // root, so the root alone is not a safe thing to hand a tool.
    selfContained: !skill.rootSkill,
  }
}

/** Copies exactly the manifest into destRoot. Nothing else can be observed there. */
export async function materialiseCandidate(
  manifest: CandidateManifest,
  destRoot: string,
): Promise<string> {
  for (const entry of manifest.entries) {
    const dest = join(destRoot, entry.relPath)
    await mkdir(dirname(dest), { recursive: true })
    if (entry.kind === 'symlink') {
      await symlink(entry.target, dest)
    } else {
      await copyFile(join(manifest.root, entry.relPath), dest)
      if (entry.exec) await chmod(dest, 0o755)
    }
  }
  return destRoot
}
