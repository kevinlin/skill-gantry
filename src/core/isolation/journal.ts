import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readFile, readlink, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Exec } from '../tools/exec.js'
import { preimageOf } from './git-worktree.js'
import type { ChangeSet } from './types.js'

export interface JournalEntry {
  path: string
  /** null when the path did not exist, which is how rollback knows to remove it. */
  priorSha: string | null
  priorMode: number | null
  /** Filename under `journal-bytes/`, or null for a path that did not exist. */
  priorBytesRef: string | null
}

export interface Journal {
  runId: string
  stage: string
  liveRoot: string
  /** False until every target has been written. A crash leaves it false. */
  complete: boolean
  entries: JournalEntry[]
}

export interface ApplyInput {
  /** Where journal.json lives: the run directory or a retire directory. */
  recordDir: string
  /** Design §12.2 names both on the journal, so both are supplied. */
  runId: string
  stage: string
  /** The user's repo root — what is being written. */
  liveRoot: string
  /** Where the approved bytes are. Equals liveRoot for the snapshot strategy. */
  sourceRoot: string
  change: ChangeSet
  exec: Exec
}

const BYTES_DIR = 'journal-bytes'

export const journalPath = (recordDir: string): string => join(recordDir, 'journal.json')

/**
 * fsyncs a directory. A file's own fsync only guarantees its bytes are
 * durable; the directory entry that names it (created by `open('w')` or by
 * `rename`) is a separate write the OS is free to persist on its own
 * schedule unless the directory itself is fsynced too.
 */
export async function fsyncDir(dir: string): Promise<void> {
  const handle = await open(dir, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Write, fsync the file, then fsync its directory — the same durable-write
 * shape as the sidecar index (R6.4). R10.9 needs the prior-bytes backup and
 * the journal record to be *durable on disk*, not merely written in program
 * order, before the first live target is touched: absent this barrier a
 * power loss can persist the live mutation while the backup or the journal
 * entry naming it is still sitting in a write-back cache, which is precisely
 * the crash R10.9 exists to survive.
 */
async function writeDurable(path: string, bytes: Buffer | string): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.write(typeof bytes === 'string' ? Buffer.from(bytes) : bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsyncDir(dirname(path))
}

/**
 * `copyFile` then fsync the copy and the directory naming it. Shared with the
 * snapshot sandbox, whose pre-state is the same kind of backup the journal's
 * `journal-bytes/` is: the mutating tool writes the real tree right after, so a
 * power loss can otherwise persist the live modification while `snapshot-pre/`
 * is still in write-back cache — the crash R10.9 and R10.10 exist to survive.
 */
export async function copyDurable(source: string, dest: string): Promise<void> {
  await copyFile(source, dest)
  const handle = await open(dest, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsyncDir(dirname(dest))
}

async function writeJournalFile(recordDir: string, journal: Journal): Promise<void> {
  await writeDurable(journalPath(recordDir), `${JSON.stringify(journal, null, 2)}\n`)
}

export async function readJournal(recordDir: string): Promise<Journal | null> {
  try {
    return JSON.parse(await readFile(journalPath(recordDir), 'utf8')) as Journal
  } catch {
    return null
  }
}

/**
 * R10.11. Every target's current bytes are compared against the preimage taken
 * when the change set was built, and any mismatch aborts before the first write.
 * Without this, an edit made while the diff sat awaiting approval was silently
 * overwritten, and the mutation timeout is how wide that window gets.
 */
export async function recheckPreimages(liveRoot: string, change: ChangeSet): Promise<string[]> {
  const drifted: string[] = []
  for (const expected of change.preimages) {
    const actual = await preimageOf(liveRoot, expected.path)
    if (actual.sha256 !== expected.sha256 || actual.mode !== expected.mode) {
      drifted.push(expected.path)
    }
  }
  return drifted
}

/**
 * True for a mode `lstat` took over a symlink. The journal never adds a "kind"
 * field for this: `priorMode` already carries `S_IFLNK`, and a second field
 * saying the same thing is a second field that can disagree.
 */
const isSymlinkMode = (mode: number | null): boolean =>
  mode !== null && (mode & constants.S_IFMT) === constants.S_IFLNK

/** Temp file in the target's own directory, fsynced, then renamed over it. */
async function writeAtomic(dest: string, bytes: Buffer, mode: number | undefined): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const temp = `${dest}.sg-tmp`
  const handle = await open(temp, 'w')
  try {
    await handle.write(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (mode !== undefined) await chmod(temp, mode & 0o7777)
  await rename(temp, dest)
}

/**
 * The link equivalent of `writeAtomic`, and the reason it cannot share its
 * body: a symlink has no bytes to write and no mode to chmod (`chmod` follows
 * the link, so applying the stored `0o777` would have altered the *target*'s
 * permissions). Same temp-then-rename shape, so a target being replaced is
 * never observed missing.
 */
async function linkAtomic(dest: string, target: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const temp = `${dest}.sg-tmp`
  await rm(temp, { force: true })
  await symlink(target, temp)
  await rename(temp, dest)
}

/**
 * POSIX offers no multi-file atomic write, so this does not claim atomicity —
 * it is a compensating-transaction record. Prior bytes first, then one atomic
 * write per target, then the completion mark. A crash leaves the journal
 * incomplete and `rollbackJournal` puts every recorded path back.
 */
export async function applyJournalled(input: ApplyInput): Promise<void> {
  const { change, liveRoot, sourceRoot, recordDir } = input

  const drifted = await recheckPreimages(liveRoot, change)
  if (drifted.length > 0) {
    throw new Error(`preimage-drift: ${drifted.join(', ')}`)
  }

  // Both sides of a rename are targets: one is written, the other removed.
  const targets = [...new Set(change.entries.flatMap((e) => (e.from ? [e.path, e.from] : [e.path])))]

  const bytesDir = join(recordDir, BYTES_DIR)
  await mkdir(bytesDir, { recursive: true })

  const entries: JournalEntry[] = []
  for (const path of targets) {
    const prior = await preimageOf(liveRoot, path)
    let ref: string | null = null
    if (prior.sha256 !== null) {
      // Keyed by the target's path, not its content: two targets with
      // identical bytes still get distinct backup files, so nothing here
      // is deduplicated by content and a rollback never has to reason about
      // which path a shared blob belongs to.
      ref = createHash('sha256').update(path).digest('hex').slice(0, 16)
      // A link's backup is its target string, not the target's bytes. Reading
      // through it stored a copy of a file the mutation never touched, and the
      // rollback then put that copy back as a regular file — the link was gone
      // either way, and a dangling one could not be backed up at all.
      const backup = isSymlinkMode(prior.mode)
        ? await readlink(join(liveRoot, path))
        : await readFile(join(liveRoot, path))
      await writeDurable(join(bytesDir, ref), backup)
    }
    entries.push({ path, priorSha: prior.sha256, priorMode: prior.mode, priorBytesRef: ref })
  }

  // Everything above this line is durable on disk before the line below runs
  // (R10.9): the backups and the journal record naming them must survive a
  // crash that happens the instant after the first live target is mutated.
  const journal: Journal = {
    runId: input.runId,
    stage: input.stage,
    liveRoot,
    complete: false,
    entries,
  }
  await writeJournalFile(recordDir, journal)

  const removed = new Set(change.entries.flatMap((e) => (e.from ? [e.from] : [])))
  for (const entry of change.entries) {
    if (entry.kind === 'deleted') {
      await rm(join(liveRoot, entry.path), { force: true })
      continue
    }
    if (entry.kind === 'mode-changed') {
      if (entry.mode !== undefined) await chmod(join(liveRoot, entry.path), entry.mode & 0o7777)
      continue
    }
    // Snapshot strategy: source and live are the same tree, so the bytes are
    // already in place and only the removals and modes remain.
    if (sourceRoot !== liveRoot) {
      const source = join(sourceRoot, entry.path)
      const info = await lstat(source)
      if (info.isSymbolicLink()) {
        // Recreated as a link. `readFile` here wrote a regular file holding the
        // target's bytes into the user's tree, so a sandbox that preserved the
        // link (§4.4, R2.10) still applied it as a copy.
        await linkAtomic(join(liveRoot, entry.path), await readlink(source))
      } else {
        await writeAtomic(join(liveRoot, entry.path), await readFile(source), entry.mode)
      }
    }
  }
  for (const path of removed) await rm(join(liveRoot, path), { force: true })

  await writeJournalFile(recordDir, { ...journal, complete: true })
}

/**
 * Removes the `<target>.sg-tmp` files `writeAtomic` leaves behind when a crash
 * lands between creating one and renaming it over its target. They matter
 * beyond tidiness: a leftover temp inside the candidate root is a file the
 * manifest walk would pick up, so it changes every later digest — and a digest
 * change is what makes release refuse. Swept during recovery, which is the one
 * moment something is known to have crashed mid-apply.
 */
export async function sweepApplyTemps(journal: Journal): Promise<string[]> {
  const swept: string[] = []
  for (const entry of journal.entries) {
    const temp = `${join(journal.liveRoot, entry.path)}.sg-tmp`
    try {
      await rm(temp)
      swept.push(entry.path)
    } catch {
      // Not there is the normal case.
    }
  }
  return swept
}

/**
 * Compensating rollback (R10.9). Returns the paths it restored, so a caller can
 * report them; an empty array means the journal was complete and nothing needed
 * compensating.
 */
export async function rollbackJournal(recordDir: string): Promise<string[]> {
  const journal = await readJournal(recordDir)
  if (!journal || journal.complete) return []
  const restored: string[] = []
  for (const entry of journal.entries) {
    const dest = join(journal.liveRoot, entry.path)
    if (entry.priorBytesRef === null) {
      await rm(dest, { force: true })
    } else {
      const backup = join(recordDir, BYTES_DIR, entry.priorBytesRef)
      if (isSymlinkMode(entry.priorMode)) {
        await linkAtomic(dest, await readFile(backup, 'utf8'))
      } else {
        await writeAtomic(dest, await readFile(backup), entry.priorMode ?? undefined)
      }
    }
    restored.push(entry.path)
  }
  await writeJournalFile(recordDir, { ...journal, complete: true })
  return restored
}
