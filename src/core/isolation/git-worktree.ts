import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize, sep } from 'node:path'
import type { SkillRef } from '../types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
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

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export async function preimageOf(root: string, relPath: string): Promise<Preimage> {
  try {
    const abs = join(root, relPath)
    const info = await lstat(abs)
    return { path: relPath, sha256: sha256(await readFile(abs)), mode: info.mode }
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

/** The scope paths git reports as dirty in the user's working tree. */
async function dirtyScopePaths(
  repoPath: string,
  scope: readonly string[],
  exec: Exec,
): Promise<string[]> {
  const { stdout } = await exec('git', ['status', '--porcelain=v1', '-z', '--', ...scope], {
    cwd: repoPath,
    timeoutMs: 60_000,
  })
  const fields = nulFields(stdout)
  const paths: string[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] as string
    // `status -z` puts the NEW path first for a rename and the old one after,
    // which is the opposite of `diff --raw -z`.
    paths.push(field.slice(3))
    if (field.startsWith('R') || field.startsWith('C')) i += 1
  }
  return paths
}

export async function openGitWorktreeSandbox(input: SandboxInput): Promise<MutationSandbox> {
  const exec = input.exec ?? defaultExec
  const repoPath = input.skill.repo.path
  const scope = [...input.scope]

  const dirty = await dirtyScopePaths(repoPath, scope, exec)
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
  for (const relPath of scope) {
    const preimage = await preimageOf(repoPath, relPath)
    preimages.push(preimage)
    if (!dirty.includes(relPath)) continue
    // R10.3's second half: seed the worktree with the user's actual bytes.
    const target = join(workRoot, relPath)
    if (preimage.sha256 === null) {
      await rm(target, { force: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(repoPath, relPath), target)
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
    await exec('git', ['add', '-A'], { cwd: workRoot, timeoutMs: 120_000 })
    await exec('git', ['commit', '-q', '-m', 'seed dirty scope'], {
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
    // untracked add — the case R10.8 names. No `-- scope` pathspec here: `git
    // add -A` errors fatally on a pathspec that matches nothing at all (a
    // scope entry never created, e.g. an unreleased CHANGELOG.md), and the
    // diff commands below already restrict their output to scope.
    await exec('git', ['add', '-A'], { cwd: workRoot, timeoutMs: 120_000 })
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
      await applyJournalled({ recordDir: input.recordDir, liveRoot: repoPath, sourceRoot: workRoot, change, exec })
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
