import { chmod, copyFile, lstat, mkdir, readFile, readdir, rm, stat, symlink, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import type { SkillRef } from '../types.js'
import { defaultExec } from '../tools/exec.js'
import { unifiedDiffFor } from './diff.js'
import { type SandboxInput, preimageOf } from './git-worktree.js'
import { applyJournalled } from './journal.js'
import { markSandboxRecord, writeSandboxRecord } from './record.js'
import type { ChangeEntry, ChangeSet, MutationSandbox, Preimage } from './types.js'

export interface SnapshotInput extends SandboxInput {
  /** `<run>/snapshot-pre` — inside the workspace, never inside the candidate. */
  snapshotDir: string
}

/** Bytes are binary if they hold a NUL in the first 8 KiB, which is git's rule. */
const looksBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8192).includes(0)

const posix = (p: string): string => p.split(sep).join('/')

/**
 * The workspace path relative to the repo root, repo-root-skill or not: for a
 * repo-root skill it sits inside the repo being scoped, and the run directory
 * holding the snapshot being written lives inside it. Without this exclusion a
 * scope of "." would copy the snapshot into itself — R6.8's failure mode.
 */
function excludedRoot(skill: SkillRef): string {
  return posix(relative(skill.repo.path, skill.workspacePath))
}

const isExcluded = (relPath: string, excluded: string): boolean =>
  relPath === excluded || relPath.startsWith(`${excluded}/`)

async function copyInto(
  liveRoot: string,
  relPath: string,
  destRoot: string,
  excluded: string,
): Promise<void> {
  if (isExcluded(relPath, excluded)) return
  const source = join(liveRoot, relPath)
  let info
  try {
    info = await lstat(source)
  } catch {
    // A scope path need not exist: release declares CHANGELOG.md and the
    // archive, and neither exists before the first release.
    return
  }
  const dest = join(destRoot, relPath)
  await mkdir(dirname(dest), { recursive: true })
  if (info.isSymbolicLink()) {
    // R2.10 holds in every consumer of the manifest, snapshots included.
    await symlink(await readlink(source), dest)
    return
  }
  if (info.isDirectory()) {
    // A plain recursive `cp` refuses outright when the destination sits
    // inside the source tree — which it does for a repo-root scope, since
    // the run directory holding this snapshot lives under the workspace
    // this walk would otherwise descend into. Copying file-by-file through
    // the already-exclusion-aware `expand` sidesteps that check entirely
    // rather than working around it.
    for (const rel of await expand(liveRoot, relPath, excluded)) {
      await copyInto(liveRoot, rel, destRoot, excluded)
    }
    return
  }
  await copyFile(source, dest)
  await chmod(dest, info.mode & 0o7777)
}

/** Every file under a scope path, as repo-relative paths. */
async function expand(root: string, relPath: string, excluded: string): Promise<string[]> {
  if (isExcluded(relPath, excluded)) return []
  let info
  try {
    info = await lstat(join(root, relPath))
  } catch {
    return []
  }
  if (!info.isDirectory()) return [relPath]
  const out: string[] = []
  for (const entry of await readdir(join(root, relPath), { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue
    const abs = join(entry.parentPath, entry.name)
    const rel = posix(relative(root, abs))
    if (isExcluded(rel, excluded)) continue
    out.push(rel)
  }
  return out
}

export async function openSnapshotSandbox(input: SnapshotInput): Promise<MutationSandbox> {
  const exec = input.exec ?? defaultExec
  const liveRoot = input.skill.repo.path
  const scope = [...input.scope]
  const excluded = excludedRoot(input.skill)

  for (const relPath of scope) await copyInto(liveRoot, relPath, input.snapshotDir, excluded)

  const preimages: Preimage[] = []
  for (const relPath of scope) preimages.push(await preimageOf(liveRoot, relPath))

  await writeSandboxRecord(input.recordDir, {
    runId: input.runId,
    stage: input.stage,
    strategy: 'snapshot',
    state: 'active',
    scope,
    repoPath: liveRoot,
    skillId: input.skill.id,
    snapshotDir: input.snapshotDir,
    workRoot: liveRoot,
    preimages,
    openedAt: new Date().toISOString(),
  })

  const resolve = (repoRelPath: string): string => {
    const normalised = normalize(repoRelPath)
    if (isAbsolute(normalised) || normalised === '..' || normalised.startsWith(`..${sep}`)) {
      throw new Error(`scope-escapes-root: ${repoRelPath}`)
    }
    return join(liveRoot, normalised)
  }

  const changeSet = async (): Promise<ChangeSet> => {
    const paths = new Set<string>()
    for (const relPath of scope) {
      for (const p of await expand(liveRoot, relPath, excluded)) paths.add(p)
      for (const p of await expand(input.snapshotDir, relPath, excluded)) paths.add(p)
    }

    const before = new Map<string, Preimage>()
    const after = new Map<string, Preimage>()
    for (const relPath of paths) {
      before.set(relPath, await preimageOf(input.snapshotDir, relPath))
      after.set(relPath, await preimageOf(liveRoot, relPath))
    }

    // A delete and an add with equal content is a rename. There is no index to
    // ask, so identity comes from the bytes — which is also what R10.8 needs, a
    // rename represented as one entry rather than as an unrelated pair.
    const deleted = [...paths].filter((p) => before.get(p)?.sha256 && !after.get(p)?.sha256)
    const added = [...paths].filter((p) => !before.get(p)?.sha256 && after.get(p)?.sha256)
    const renames = new Map<string, string>()
    for (const from of deleted) {
      const hash = before.get(from)?.sha256
      const to = added.find((p) => after.get(p)?.sha256 === hash && !renames.has(p))
      if (to) renames.set(to, from)
    }

    const entries: ChangeEntry[] = []
    for (const relPath of [...paths].sort()) {
      const was = before.get(relPath) as Preimage
      const now = after.get(relPath) as Preimage
      if (was.sha256 === null && now.sha256 === null) continue
      if (renames.has(relPath)) {
        entries.push({ path: relPath, kind: 'renamed', from: renames.get(relPath) as string, binary: false })
        continue
      }
      if ([...renames.values()].includes(relPath)) continue
      if (was.sha256 === now.sha256 && was.mode !== now.mode) {
        entries.push({ path: relPath, kind: 'mode-changed', mode: now.mode ?? 0, binary: false })
        continue
      }
      if (was.sha256 === now.sha256) continue

      const kind = was.sha256 === null ? 'added' : now.sha256 === null ? 'deleted' : 'modified'
      const sample = now.sha256 === null
        ? await readFile(join(input.snapshotDir, relPath)).catch(() => Buffer.alloc(0))
        : await readFile(join(liveRoot, relPath)).catch(() => Buffer.alloc(0))
      entries.push({
        path: relPath,
        kind,
        ...(now.mode === null ? {} : { mode: now.mode }),
        binary: looksBinary(sample),
      })
    }

    const diffs: string[] = []
    for (const entry of entries) {
      if (entry.binary || entry.kind === 'mode-changed' || entry.kind === 'renamed') continue
      diffs.push(
        await unifiedDiffFor(
          before.get(entry.path)?.sha256 === null ? null : join(input.snapshotDir, entry.path),
          after.get(entry.path)?.sha256 === null ? null : join(liveRoot, entry.path),
          entry.path,
          exec,
        ),
      )
    }

    return {
      entries,
      unifiedDiff: diffs.join(''),
      // Against the live tree, which is what the apply will write over.
      preimages: await Promise.all([...paths].map((relPath) => preimageOf(liveRoot, relPath))),
    }
  }

  return {
    strategy: 'snapshot',
    workRoot: liveRoot,
    resolve,
    changeSet,
    apply: async (change) => {
      // The tool already wrote the live tree, so there is nothing to move. The
      // journal is still written: R10.9 wants the prior bytes on record, and
      // R10.11's recheck is what catches a user edit made while the diff sat
      // awaiting approval.
      await applyJournalled({ recordDir: input.recordDir, liveRoot, sourceRoot: liveRoot, change, exec })
      await markSandboxRecord(input.recordDir, 'applied')
    },
    discard: async () => {
      await restoreSnapshot(input.snapshotDir, liveRoot, scope, excluded)
      await markSandboxRecord(input.recordDir, 'discarded')
    },
    // The snapshot is run evidence under the sidecar, so it outlives the
    // sandbox. Removing it would take the only copy of the pre-stage bytes.
    dispose: async () => undefined,
  }
}

/** Shared with startup recovery, which restores from the same directory. */
export async function restoreSnapshot(
  snapshotDir: string,
  liveRoot: string,
  scope: readonly string[],
  excluded = '',
): Promise<void> {
  for (const relPath of scope) {
    const live = [...new Set(await expand(liveRoot, relPath, excluded))]
    const saved = new Set(await expand(snapshotDir, relPath, excluded))
    // Anything the tool created that the snapshot never held.
    for (const p of live) {
      if (!saved.has(p)) await rm(join(liveRoot, p), { force: true })
    }
    for (const p of saved) {
      const source = join(snapshotDir, p)
      const dest = join(liveRoot, p)
      await mkdir(dirname(dest), { recursive: true })
      const info = await lstat(source)
      if (info.isSymbolicLink()) {
        await rm(dest, { force: true })
        await symlink(await readlink(source), dest)
        continue
      }
      await copyFile(source, dest)
      await chmod(dest, (await stat(source)).mode & 0o7777)
    }
  }
}
