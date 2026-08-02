import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SandboxRecord, SandboxState } from './types.js'

const FILE = 'sandbox.json'

export const sandboxRecordPath = (dir: string): string => join(dir, FILE)

/**
 * Written whole and renamed into place, so a reader never sees half a record.
 * A truncated marker is worse than none: recovery would offer to restore from a
 * snapshot directory it could not name.
 */
export async function writeSandboxRecord(dir: string, record: SandboxRecord): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = sandboxRecordPath(dir)
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`)
  await rename(temp, target)
}

export async function readSandboxRecord(dir: string): Promise<SandboxRecord | null> {
  try {
    return JSON.parse(await readFile(sandboxRecordPath(dir), 'utf8')) as SandboxRecord
  } catch {
    return null
  }
}

export async function markSandboxRecord(dir: string, state: SandboxState): Promise<void> {
  const record = await readSandboxRecord(dir)
  if (!record) return
  await writeSandboxRecord(dir, { ...record, state })
}

/**
 * Every place a sandbox can live under one skill's workspace. Retirement uses
 * `retire/<id>/` rather than a run directory precisely so this scan finds it
 * with no second code path.
 */
async function candidateDirs(workspacePath: string): Promise<string[]> {
  const root = join(workspacePath, 'skillgantry')
  const out: string[] = []
  for (const group of ['runs', 'retire']) {
    const base = join(root, group)
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) out.push(join(base, entry.name))
    }
  }
  return out
}

/** Only `active` records: applied or discarded is resolved history. */
export async function scanSandboxRecords(workspacePath: string): Promise<SandboxRecord[]> {
  const found: SandboxRecord[] = []
  for (const dir of await candidateDirs(workspacePath)) {
    const record = await readSandboxRecord(dir)
    if (record?.state === 'active') found.push(record)
  }
  return found
}
