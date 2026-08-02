import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
      ref = createHash('sha256').update(path).digest('hex').slice(0, 16)
      await copyFile(join(liveRoot, path), join(bytesDir, ref))
    }
    entries.push({ path, priorSha: prior.sha256, priorMode: prior.mode, priorBytesRef: ref })
  }

  const journal: Journal = {
    runId: '',
    stage: '',
    liveRoot,
    complete: false,
    entries,
  }
  await writeFile(journalPath(recordDir), `${JSON.stringify(journal, null, 2)}\n`)

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

  await writeFile(journalPath(recordDir), `${JSON.stringify({ ...journal, complete: true }, null, 2)}\n`)
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
  await writeFile(journalPath(recordDir), `${JSON.stringify({ ...journal, complete: true }, null, 2)}\n`)
  return restored
}
