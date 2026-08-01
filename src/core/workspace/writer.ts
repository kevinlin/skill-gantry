import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import type { Provenance } from '../config/env.js'
import type { StageResult } from '../stages/types.js'
import { indexPath, latestPath, lockPath, runsRoot } from './layout.js'

export { stageDirFor, toolDirFor } from './layout.js'

const WORKSPACE_MODE = 0o700
const IGNORE_PATTERNS = ['*-workspace/', '.skillgantry-workspace/']

export interface RunMeta {
  runId: string
  skillId: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
  provenance: Provenance
  toolLock: Record<string, string>
}

export interface IndexEntry {
  runId: string
  outcome: string
  endedAt: string
}

export interface ClaimedRun {
  runId: string
  runDir: string
}

/**
 * Uniqueness is claimed by exclusive mkdir, not assumed from the identifier.
 * A collision retries rather than letting two runs share one directory.
 */
export async function claimRunDir(workspacePath: string): Promise<ClaimedRun> {
  const root = runsRoot(workspacePath)
  await mkdir(root, { recursive: true, mode: WORKSPACE_MODE })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runId = uuidv7()
    const runDir = join(root, runId)
    try {
      await mkdir(runDir, { recursive: false, mode: WORKSPACE_MODE })
      return { runId, runDir }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('could not claim a unique run directory after 5 attempts')
}

export async function writeRunJson(runDir: string, meta: RunMeta): Promise<void> {
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify(meta, null, 2)}\n`)
}

export async function writeStageJson(
  stageDir: string,
  result: StageResult,
  unredactedByTool: Readonly<Record<string, readonly string[]>> = {},
): Promise<void> {
  await mkdir(stageDir, { recursive: true })
  const doc = {
    stage: result.stage,
    outcome: result.outcome,
    verdict: result.verdict,
    toolRuns: result.toolRuns.map((run) => ({
      ...run,
      // R7.4a: native artefacts are not redacted, so the exposure is recorded.
      unredactedArtefacts: unredactedByTool[run.toolId] ?? [],
      redacted: false,
    })),
  }
  await writeFile(join(stageDir, 'stage.json'), `${JSON.stringify(doc, null, 2)}\n`)
}

/** A lock older than this with a dead holder is reclaimable. */
export const LOCK_STALE_MS = 30_000

const holderAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export type ReclaimReason = 'dead-holder' | 'stale-lease'

export type ReclaimListener = (path: string, pid: number, reason: ReclaimReason) => void

export const reclaimLogPath = (workspacePath: string): string =>
  join(workspacePath, 'skillgantry', 'lock-reclaims.log')

/**
 * R6.9 requires a reclaim to be logged, and `core` may not write to the
 * console, so the record goes where the evidence already lives. Fire and
 * forget: failing to log must never fail the run that reclaimed the lock.
 */
export function appendReclaimLog(workspacePath: string, pid: number, reason: ReclaimReason): void {
  const line = JSON.stringify({ at: new Date().toISOString(), pid, reason, by: process.pid })
  void appendFile(reclaimLogPath(workspacePath), `${line}\n`).catch(() => undefined)
}

/**
 * Leased per-skill lock. A bare `wx` lockfile is not enough: if the holder is
 * killed the file survives and that skill can never be finalised again. The
 * lease makes the failure recoverable — a waiter may break a lock whose holder
 * is gone, or whose heartbeat has stopped for longer than the threshold.
 */
export async function withSkillLock<T>(
  workspacePath: string,
  fn: () => Promise<T>,
  timeoutMs = 10_000,
  onReclaim: ReclaimListener = (_path, pid, reason) => appendReclaimLog(workspacePath, pid, reason),
): Promise<T> {
  const path = lockPath(workspacePath)
  await mkdir(join(workspacePath, 'skillgantry'), { recursive: true, mode: WORKSPACE_MODE })
  const deadline = Date.now() + timeoutMs

  for (;;) {
    try {
      const handle = await open(path, 'wx')
      await handle.write(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      await handle.close()
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err

      const info = await stat(path).catch(() => null)
      if (info) {
        // Creating the lockfile and writing its holder are two steps, so a
        // second process can read it empty. An unreadable body means "holder
        // unknown", never "holder dead": only the lease may reclaim it.
        const raw = await readFile(path, 'utf8').catch(() => '')
        let held: { pid?: number } = {}
        try {
          held = raw.length > 0 ? (JSON.parse(raw) as { pid?: number }) : {}
        } catch {
          held = {}
        }
        const stale = Date.now() - info.mtimeMs > LOCK_STALE_MS
        const dead = typeof held.pid === 'number' && !holderAlive(held.pid)
        if (dead || stale) {
          onReclaim(path, held.pid ?? -1, dead ? 'dead-holder' : 'stale-lease')
          await rm(path, { force: true })
          continue
        }
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`)
      await new Promise((r) => setTimeout(r, 15))
    }
  }

  const heartbeat = setInterval(() => {
    void utimes(path, new Date(), new Date()).catch(() => undefined)
  }, LOCK_STALE_MS / 3)

  try {
    return await fn()
  } finally {
    clearInterval(heartbeat)
    await rm(path, { force: true })
  }
}

/**
 * Reads the index, discarding a final line that a crash truncated. Every record
 * is also present in full inside its own run directory, so a lost tail line
 * costs an index entry and never evidence.
 */
export async function readIndex(workspacePath: string): Promise<IndexEntry[]> {
  let body: string
  try {
    body = await readFile(indexPath(workspacePath), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: IndexEntry[] = []
  for (const line of body.split('\n')) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as IndexEntry)
    } catch {
      // Only the last line can be partial; anything else is not recoverable
      // here either, and skipping it is the same conservative choice.
    }
  }
  return out
}

export async function finalizeRun(workspacePath: string, entry: IndexEntry): Promise<void> {
  await withSkillLock(workspacePath, async () => {
    const path = indexPath(workspacePath)
    const info = await stat(path).catch(() => null)
    let prefix = ''
    if (info && info.size > 0) {
      const handle = await open(path, 'r')
      try {
        const tail = Buffer.alloc(1)
        await handle.read(tail, 0, 1, info.size - 1)
        // A previous crash may have lost the terminating newline. Starting on a
        // fresh line means one damaged record can never corrupt the next.
        if (tail[0] !== 0x0a) prefix = '\n'
      } finally {
        await handle.close()
      }
    }

    const handle = await open(path, 'a')
    try {
      // One write call per record, newline included, then fsync.
      await handle.write(`${prefix}${JSON.stringify(entry)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }

    // `latest` is the greatest run id, not the last finaliser. UUIDv7 orders by
    // claim time, so two runs finishing out of order still agree.
    const entries = await readIndex(workspacePath)
    const newest = entries.reduce((max, e) => (e.runId > max ? e.runId : max), entry.runId)

    const link = latestPath(workspacePath)
    const temp = `${link}.tmp`
    await rm(temp, { force: true })
    await symlink(newest, temp)
    await rename(temp, link)
  })
}

export async function ensureGitignore(repoPath: string): Promise<void> {
  const path = join(repoPath, '.gitignore')
  let body = ''
  try {
    body = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const lines = new Set(body.split(/\r?\n/).map((l) => l.trim()))
  const missing = IGNORE_PATTERNS.filter((p) => !lines.has(p))
  if (missing.length === 0) return

  const prefix = body.length === 0 || body.endsWith('\n') ? '' : '\n'
  await writeFile(path, `${body}${prefix}${missing.join('\n')}\n`)
}
