import { createHash } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import type { SkillRef } from '../types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import {
  type CandidatePolicy,
  candidatePolicyFor,
  containsAllowed,
  underCandidateRoot,
} from './candidate-policy.js'
import { applyJournalled } from './journal.js'
import { markSandboxRecord, writeSandboxRecord } from './record.js'
import type { ChangeEntry, ChangeSet, MutationSandbox, Preimage } from './types.js'

export interface SandboxInput {
  skill: SkillRef
  stage: string
  runId: string
  recordDir: string
  scope: readonly string[]
  /** R10.3: proceed against a dirty scope path only when the user says so. */
  allowDirty?: boolean
  exec?: Exec
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

/**
 * A symlink is hashed by its target string, never by following it — the same
 * rule §4.4 already applies to the candidate digest. Following it made a link
 * indistinguishable from a copy of whatever it pointed at: a dangling one read
 * as "the path does not exist", so the drift recheck saw no change where the
 * link had been retargeted at a missing file, and rollback would have deleted
 * a link it was meant to restore. The mode comes from `lstat`, so it carries
 * `S_IFLNK` and is what later tells the journal which kind it is putting back.
 */
export async function preimageOf(root: string, relPath: string): Promise<Preimage> {
  try {
    const abs = join(root, relPath)
    const info = await lstat(abs)
    const content = info.isSymbolicLink() ? await readlink(abs) : await readFile(abs)
    return { path: relPath, sha256: sha256(content), mode: info.mode }
  } catch {
    return { path: relPath, sha256: null, mode: null }
  }
}

/** Splits a NUL-delimited git stream, dropping the trailing empty field. */
const nulFields = (raw: string): string[] => raw.split('\0').filter((f) => f.length > 0)

/**
 * `--numstat -z -M` marks a binary file with `-` in both count columns. It is
 * the only place git says "binary"; `--raw` does not carry it.
 */
export function binaryPaths(numstat: string): Set<string> {
  const out = new Set<string>()
  const fields = nulFields(numstat)
  for (let i = 0; i < fields.length; i += 1) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(fields[i] as string)
    if (!match) continue
    const added = match[1] as string
    const inline = match[3] as string
    // A rename carries its two paths as the following fields and leaves the
    // inline path empty. A renamed binary's bytes are unchanged, so it is
    // classified `renamed` and never needs the binary flag.
    if (inline.length === 0) {
      i += 2
      continue
    }
    if (added === '-') out.add(inline)
  }
  return out
}

/**
 * `:<srcMode> <dstMode> <srcSha> <dstSha> <status>` then the path, or two paths
 * for a rename — **old first**, which inverts the order
 * `git status --porcelain -z` uses for the same change.
 *
 * A mode change reports status `M`, so `srcMode !== dstMode` is the only signal.
 * Classifying by the status letter alone lost every mode change silently, and
 * R10.8 names it as one of the five kinds that must be represented.
 */
export function parseRawDiff(raw: string, binary: ReadonlySet<string>): ChangeEntry[] {
  const fields = nulFields(raw)
  const entries: ChangeEntry[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const meta = fields[i] as string
    if (!meta.startsWith(':')) continue
    const [srcMode, dstMode, , , status = 'M'] = meta.slice(1).split(/\s+/)
    const letter = status.charAt(0)
    const renamed = letter === 'R' || letter === 'C'
    const first = fields[++i] as string
    const path = renamed ? (fields[++i] as string) : first
    const mode = Number.parseInt(dstMode ?? '0', 8)

    const kind: ChangeEntry['kind'] = renamed
      ? 'renamed'
      : letter === 'A'
        ? 'added'
        : letter === 'D'
          ? 'deleted'
          : srcMode !== dstMode
            ? 'mode-changed'
            : 'modified'

    entries.push({
      path,
      kind,
      ...(renamed ? { from: first } : {}),
      ...(Number.isNaN(mode) || mode === 0 ? {} : { mode }),
      binary: binary.has(path),
    })
  }
  return entries
}

/**
 * The paths git reports as dirty in the user's working tree, across the
 * declared scope **and the whole candidate**.
 *
 * Scope alone was too narrow. `ReleaseStageExecutor` digests the candidate as
 * the sandbox sees it — HEAD plus whatever was seeded — and compares that to
 * the digest the gates passed against, which was taken from the live tree. Any
 * uncommitted candidate file outside the scope (`sk/reference.md`, say) made
 * those two disagree, so release refused with `digest-mismatch` and told the
 * user to re-run the gates, which reproduced the same live digest and refused
 * again. Naming the uncommitted work is actionable; `--allow-dirty` is still
 * the way past it, and seeding then makes the two digests agree.
 */
export async function dirtyPaths(
  repoPath: string,
  scope: readonly string[],
  policy: CandidatePolicy,
  exec: Exec,
): Promise<string[]> {
  const pathspec = [...new Set([...scope, policy.root === '' ? '.' : policy.root])]
  const { stdout } = await exec('git', ['status', '--porcelain=v1', '-z', '--', ...pathspec], {
    cwd: repoPath,
    timeoutMs: 60_000,
  })
  const fields = nulFields(stdout)
  const inScope = new Set(scope)
  const paths: string[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] as string
    // `status -z` puts the NEW path first for a rename and the old one after,
    // which is the opposite of `diff --raw -z`.
    const raw = [field.slice(3)]
    if (field.startsWith('R') || field.startsWith('C')) {
      i += 1
      // Both halves, because both are dirty. Only the new one used to be taken,
      // so a *staged* rename left HEAD's copy of the old path sitting in the
      // seeded worktree — two files where the user has one — and the candidate
      // digest disagreed with the live one all over again. An unstaged rename
      // never had the problem: git reports it as a separate ` D` and `??`.
      const old = fields[i]
      if (old !== undefined) raw.push(old)
    }
    for (const each of raw) {
      const relPath = each.endsWith('/') ? each.slice(0, -1) : each
      if (inScope.has(relPath) || inScope.has(each)) {
        paths.push(relPath)
        continue
      }
      // Outside the scope: dirty only counts when the path is part of the
      // candidate. Membership is asked of the manifest rather than re-derived
      // from an exclusion list here — that duplication was R6.8's bug. A path
      // the manifest excludes but that exists on disk (the sidecar workspace,
      // `.gitignore` on a repo-root skill, a previous release archive) is not
      // candidate bytes; a path that no longer exists is a deletion the manifest
      // walk could not have seen, and deletions inside the candidate do count.
      if (!underCandidateRoot(relPath, policy.root)) continue
      if (policy.allowed.has(relPath) || containsAllowed(policy, relPath)) {
        paths.push(relPath)
        continue
      }
      if (!(await pathExists(join(repoPath, relPath)))) paths.push(relPath)
    }
  }
  return paths
}

const pathExists = async (abs: string): Promise<boolean> => {
  try {
    await lstat(abs)
    return true
  } catch {
    return false
  }
}

/**
 * Stages everything in the worktree, then force-stages the declared scope.
 *
 * The second command is what makes a gitignored scope path reach the change
 * set. `*.zip` is a common `.gitignore` convention, and without `-f` the
 * release archive — placed in the sandbox at its eventual repo-relative path
 * precisely so it rides the change set (R9.4) — was silently dropped from the
 * diff, from the journal and from the user's tree while `evidence/release.json`
 * still recorded its SHA-256 and the stage still reported `passed`.
 *
 * Two commands rather than one `git add -A -f -- <scope>`: `git add` fails
 * fatally on a pathspec that matches nothing at all, and a scope entry may
 * legitimately not exist yet (an unreleased `CHANGELOG.md`), so the forced pass
 * is restricted to the entries actually present.
 */
async function stageForDiff(
  exec: Exec,
  workRoot: string,
  scope: readonly string[],
): Promise<void> {
  await exec('git', ['add', '-A'], { cwd: workRoot, timeoutMs: 120_000 })
  const present: string[] = []
  for (const relPath of scope) {
    if (await pathExists(join(workRoot, relPath))) present.push(relPath)
  }
  if (present.length === 0) return
  await exec('git', ['add', '-f', '--', ...present], { cwd: workRoot, timeoutMs: 120_000 })
}

export async function openGitWorktreeSandbox(input: SandboxInput): Promise<MutationSandbox> {
  const exec = input.exec ?? defaultExec
  const repoPath = input.skill.repo.path
  const scope = [...input.scope]

  const policy = await candidatePolicyFor(input.skill)
  const dirty = await dirtyPaths(repoPath, scope, policy, exec)
  if (dirty.length > 0 && input.allowDirty !== true) {
    throw new Error(
      `refusing to mutate a skill with uncommitted changes:\n  ${dirty.join('\n  ')}\n` +
        'commit them, or re-run with the dirty override',
    )
  }

  // mkdtemp then remove: `git worktree add` insists on creating the directory.
  const workRoot = await mkdtemp(join(tmpdir(), 'sg-worktree-'))
  await rm(workRoot, { recursive: true, force: true })
  await exec('git', ['worktree', 'add', '--detach', '-q', workRoot, 'HEAD'], {
    cwd: repoPath,
    timeoutMs: 120_000,
  })

  const preimages: Preimage[] = []
  for (const relPath of scope) preimages.push(await preimageOf(repoPath, relPath))

  // R10.3's second half: seed the worktree with the user's actual bytes. Every
  // dirty path, not just the dirty *scope* paths: the rest of the candidate is
  // what the digest is taken over, so leaving it at HEAD is what made release
  // refuse with an unactionable `digest-mismatch`.
  for (const relPath of dirty) {
    const target = join(workRoot, relPath)
    const source = join(repoPath, relPath)
    const info = await lstat(source).catch(() => null)
    if (info === null) {
      await rm(target, { recursive: true, force: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    if (info.isDirectory()) {
      await cp(source, target, { recursive: true, verbatimSymlinks: true })
      continue
    }
    await copyFile(source, target)
  }

  if (dirty.length > 0) {
    // Fold the seed into the worktree's own HEAD: otherwise the seeded bytes
    // diff against the *original* HEAD and the user's own uncommitted edit
    // shows up as a change the tool made, which is exactly what they are
    // being asked to approve or reject having never touched.
    // This commit's objects land in the repo's own .git/objects, since a
    // worktree shares the object database with its parent repo — harmless,
    // as the commit is unreachable from any real ref once the worktree is
    // removed and is ordinary GC-eligible garbage, not a leak.
    await stageForDiff(exec, workRoot, scope)
    // `--no-verify`: a worktree shares `.git/hooks` with its parent repo, so a
    // repo with a husky or pre-commit hook would either fail to open a sandbox
    // at all or have its seeded bytes rewritten by a formatter before the tool
    // ever saw them. This commit is throwaway bookkeeping, not the user's.
    await exec('git', ['commit', '-q', '--no-verify', '-m', 'seed dirty scope'], {
      cwd: workRoot,
      timeoutMs: 120_000,
    })
  }

  await writeSandboxRecord(input.recordDir, {
    runId: input.runId,
    stage: input.stage,
    strategy: 'git-worktree',
    state: 'active',
    scope,
    repoPath,
    skillId: input.skill.id,
    skillRelPath: input.skill.relPath,
    rootSkill: input.skill.rootSkill,
    snapshotDir: '',
    workRoot,
    preimages,
    openedAt: new Date().toISOString(),
  })

  const resolve = (repoRelPath: string): string => {
    const normalised = normalize(repoRelPath)
    if (isAbsolute(normalised) || normalised === '..' || normalised.startsWith(`..${sep}`)) {
      throw new Error(`scope-escapes-root: ${repoRelPath}`)
    }
    return join(workRoot, normalised)
  }

  const changeSet = async (): Promise<ChangeSet> => {
    // Staging inside a throwaway worktree costs nothing, and it is what makes
    // git report a rename as R rather than as an unrelated delete plus an
    // untracked add — the case R10.8 names. The diff commands below restrict
    // their output to scope, so the unforced pass may stage more than that.
    await stageForDiff(exec, workRoot, scope)
    const args = ['diff', '--cached']
    const [raw, numstat, diff] = await Promise.all([
      exec('git', [...args, '--raw', '-M', '-z', '--', ...scope], { cwd: workRoot }),
      exec('git', [...args, '--numstat', '-M', '-z', '--', ...scope], { cwd: workRoot }),
      exec('git', [...args, '--binary', '-M', '--', ...scope], { cwd: workRoot }),
    ])
    const entries = parseRawDiff(raw.stdout, binaryPaths(numstat.stdout))
    // Both sides of a rename: the apply deletes one and writes the other, so
    // both need a preimage for R10.11 to detect drift on either.
    const touched = new Set(entries.flatMap((e) => (e.from ? [e.path, e.from] : [e.path])))
    return {
      entries,
      unifiedDiff: diff.stdout,
      preimages: await Promise.all([...touched].map((relPath) => preimageOf(repoPath, relPath))),
    }
  }

  return {
    strategy: 'git-worktree',
    workRoot,
    resolve,
    changeSet,
    apply: async (change) => {
      await applyJournalled({
        recordDir: input.recordDir,
        runId: input.runId,
        stage: input.stage,
        liveRoot: repoPath,
        sourceRoot: workRoot,
        change,
        exec,
      })
      await markSandboxRecord(input.recordDir, 'applied')
    },
    // Nothing was written to the user's tree, so there is nothing to undo.
    discard: async () => markSandboxRecord(input.recordDir, 'discarded'),
    dispose: async () => {
      await exec('git', ['worktree', 'remove', '--force', workRoot], {
        cwd: repoPath,
        timeoutMs: 60_000,
      }).catch(async () => {
        await rm(workRoot, { recursive: true, force: true })
        await exec('git', ['worktree', 'prune'], { cwd: repoPath }).catch(() => undefined)
      })
    },
  }
}
