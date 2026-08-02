import { createHash } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
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
async function fsyncDir(dir: string): Promise<void> {
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
      await writeDurable(join(bytesDir, ref), await readFile(join(liveRoot, path)))
    }
    entries.push({ path, priorSha: prior.sha256, priorMode: prior.mode, priorBytesRef: ref })
  }

  // Everything above this line is durable on disk before the line below runs
  // (R10.9): the backups and the journal record naming them must survive a
  // crash that happens the instant after the first live target is mutated.
  const journal: Journal = {
    runId: '',
    stage: '',
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
      await writeAtomic(join(liveRoot, entry.path), await readFile(join(sourceRoot, entry.path)), entry.mode)
    }
  }
  for (const path of removed) await rm(join(liveRoot, path), { force: true })

  await writeJournalFile(recordDir, { ...journal, complete: true })
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
      await writeAtomic(
        dest,
        await readFile(join(recordDir, BYTES_DIR, entry.priorBytesRef)),
        entry.priorMode ?? undefined,
      )
    }
    restored.push(entry.path)
  }
  await writeJournalFile(recordDir, { ...journal, complete: true })
  return restored
}
