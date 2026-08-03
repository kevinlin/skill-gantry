import { chmod, copyFile, lstat, mkdir, readFile, readdir, rm, stat, symlink, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type { SkillRef } from '../types.js'
import type { CandidateEntry } from '../discovery/candidate.js'
import { defaultExec } from '../tools/exec.js'
import {
  type CandidatePolicy,
  candidatePolicyFor,
  underCandidateRoot,
} from './candidate-policy.js'
import { unifiedDiffFor } from './diff.js'
import { type SandboxInput, preimageOf } from './git-worktree.js'
import { applyJournalled, copyDurable } from './journal.js'
import { markSandboxRecord, writeSandboxRecord } from './record.js'
import type { ChangeEntry, ChangeSet, MutationSandbox, Preimage } from './types.js'

export interface SnapshotInput extends SandboxInput {
  /** `<run>/snapshot-pre` — inside the workspace, never inside the candidate. */
  snapshotDir: string
}

/** Bytes are binary if they hold a NUL in the first 8 KiB, which is git's rule. */
const looksBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8192).includes(0)

const posix = (p: string): string => p.split(sep).join('/')

/** A symlink whose target resolves outside `root` is rejected, never followed. */
function assertNoEscape(root: string, source: string, target: string, relPath: string): void {
  const resolved = resolve(dirname(source), target)
  const inside = resolved === root || resolved.startsWith(root + sep)
  if (!inside) throw new Error(`candidate-escapes-root: ${relPath} -> ${target}`)
}

async function materialiseEntry(
  liveRoot: string,
  relPath: string,
  destRoot: string,
  entry: CandidateEntry,
): Promise<void> {
  const dest = join(destRoot, relPath)
  await mkdir(dirname(dest), { recursive: true })
  if (entry.kind === 'symlink') {
    // The manifest walk already rejected an escaping target; recreate the
    // link itself rather than the bytes it points at.
    await symlink(entry.target, dest)
    return
  }
  // Durable: the mutating tool writes the real tree the moment this returns.
  await copyDurable(join(liveRoot, relPath), dest)
  if (entry.exec) await chmod(dest, 0o755)
}

/**
 * Everything below `liveRoot`'s scope path that the manifest excludes:
 * the sidecar workspace, `.gitignore` on a repo-root skill, and a prior
 * release archive. Duplicating that list here is exactly what R6.8's bug
 * was — an ad hoc exclusion narrower than the manifest's real one — so this
 * routes through `candidatePolicyFor` instead of re-deriving it.
 */
async function copyScopeEntry(
  liveRoot: string,
  relPath: string,
  destRoot: string,
  policy: CandidatePolicy,
  fallbackExcluded: string,
): Promise<void> {
  if (underCandidateRoot(relPath, policy.root)) {
    const exact = policy.allowed.get(relPath)
    if (exact) {
      await materialiseEntry(liveRoot, relPath, destRoot, exact)
      return
    }
    // Not a single manifest entry: either a directory scope entry (copy
    // every allowed path beneath it — '.' means the whole candidate root)
    // or a path the manifest excludes or that does not exist yet — both of
    // which are silently skipped, correct for a not-yet-created path
    // (release's CHANGELOG.md) and correct for an excluded one (the
    // workspace, an old archive).
    const prefix = relPath === '.' ? '' : `${relPath}/`
    for (const [rel, entry] of policy.allowed) {
      if (rel.startsWith(prefix)) await materialiseEntry(liveRoot, rel, destRoot, entry)
    }
    return
  }
  // Outside the skill's candidate root: a repo-root manifest file such as
  // `versions.json` is the case R10.1 names. `candidateManifest`'s root is
  // the skill directory, so it genuinely cannot speak for a path out here.
  // The only exclusion that still applies is the workspace directory
  // itself (R6.8's actual failure mode, reachable only when a repo-root
  // skill's scope spans the whole repo), and the same never-follow-outside
  // check the manifest gives paths inside it.
  await copyRaw(liveRoot, relPath, destRoot, fallbackExcluded)
}

const isExcluded = (relPath: string, excluded: string): boolean =>
  excluded !== '' && (relPath === excluded || relPath.startsWith(`${excluded}/`))

async function copyRaw(
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
    return
  }
  const dest = join(destRoot, relPath)
  await mkdir(dirname(dest), { recursive: true })
  if (info.isSymbolicLink()) {
    const target = await readlink(source)
    assertNoEscape(liveRoot, source, target, relPath)
    await symlink(target, dest)
    return
  }
  if (info.isDirectory()) {
    for (const rel of await expandRaw(liveRoot, relPath, excluded)) {
      await copyRaw(liveRoot, rel, destRoot, excluded)
    }
    return
  }
  await copyDurable(source, dest)
  await chmod(dest, info.mode & 0o7777)
}

/** Every file under a scope path outside the candidate root, repo-relative. */
async function expandRaw(root: string, relPath: string, excluded: string): Promise<string[]> {
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

/**
 * Every file under a scope path, repo-relative, for change detection. This is
 * deliberately not manifest-filtered: an added release archive is exactly the
 * kind of change R10.8 requires the change set to represent, even though the
 * manifest excludes an *existing* archive from candidacy. Only the workspace
 * is excluded here, so live sidecar writes are never mistaken for a change.
 */
async function expand(root: string, relPath: string, excluded: string): Promise<string[]> {
  return expandRaw(root, relPath, excluded)
}

export async function openSnapshotSandbox(input: SnapshotInput): Promise<MutationSandbox> {
  const exec = input.exec ?? defaultExec
  const liveRoot = input.skill.repo.path
  const scope = [...input.scope]
  const excluded = posix(relative(liveRoot, input.skill.workspacePath))
  const policy = await candidatePolicyFor(input.skill)

  for (const relPath of scope) await copyScopeEntry(liveRoot, relPath, input.snapshotDir, policy, excluded)

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
    skillRelPath: input.skill.relPath,
    rootSkill: input.skill.rootSkill,
    snapshotDir: input.snapshotDir,
    workRoot: liveRoot,
    preimages,
    openedAt: new Date().toISOString(),
  })

  const resolveFn = (repoRelPath: string): string => {
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
    resolve: resolveFn,
    changeSet,
    apply: async (change) => {
      // The tool already wrote the live tree, so there is nothing to move. The
      // journal is still written: R10.9 wants the prior bytes on record, and
      // R10.11's recheck is what catches a user edit made while the diff sat
      // awaiting approval.
      await applyJournalled({
        recordDir: input.recordDir,
        runId: input.runId,
        stage: input.stage,
        liveRoot,
        sourceRoot: liveRoot,
        change,
        exec,
      })
      await markSandboxRecord(input.recordDir, 'applied')
    },
    discard: async () => {
      await restoreSnapshot(input.snapshotDir, input.skill, scope)
      await markSandboxRecord(input.recordDir, 'discarded')
    },
    // The snapshot is run evidence under the sidecar, so it outlives the
    // sandbox. Removing it would take the only copy of the pre-stage bytes.
    dispose: async () => undefined,
  }
}

/**
 * Shared with startup recovery, which restores from the same directory. Takes
 * the `SkillRef` rather than a precomputed exclusion string: a prior revision
 * defaulted that string to `''` (exclude nothing), which is exactly the R6.8
 * bug this function exists to avoid — a repo-root restore that deletes its
 * own `sandbox.json` mid-restore because nothing told it not to. Requiring
 * the skill means a caller cannot omit the computation, only redo it.
 */
export async function restoreSnapshot(
  snapshotDir: string,
  skill: SkillRef,
  scope: readonly string[],
): Promise<void> {
  const liveRoot = skill.repo.path
  const excluded = posix(relative(liveRoot, skill.workspacePath))
  // The same policy the copy used. Without it the live-side expansion saw
  // everything under the scope path and deleted whatever the snapshot lacked —
  // which, for a repo-root skill with a directory scope entry (what
  // `AdapterStageExecutor.plan` produces for optimise: `paths: ['.']`), meant
  // the repo's own `.gitignore` and any pre-existing release archive, neither
  // of them ever backed up because the manifest excludes both from candidacy.
  const policy = await candidatePolicyFor(skill)
  for (const relPath of scope) {
    const live = [...new Set(await expand(liveRoot, relPath, excluded))]
    const saved = new Set(await expand(snapshotDir, relPath, excluded))
    // Anything the tool created that the snapshot never held — and nothing the
    // snapshot was never entitled to hold. Inside the candidate root the
    // manifest walk runs over the live tree, so a file the tool just created is
    // an allowed entry and is removed, while an excluded one is left alone.
    for (const p of live) {
      if (saved.has(p)) continue
      if (underCandidateRoot(p, policy.root) && !policy.allowed.has(p)) continue
      await rm(join(liveRoot, p), { force: true })
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
