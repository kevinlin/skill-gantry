import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readIndex, type SkillRef } from '../core/index.js'

export async function loadSkillMd(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return '(no SKILL.md)'
  }
}

/** Every file the run wrote, relative to the run directory, sorted. */
export async function listArtefacts(runDir: string | null): Promise<string[]> {
  if (!runDir) return []
  const out: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else out.push(rel)
    }
  }
  try {
    await walk(runDir, '')
  } catch {
    return []
  }
  return out.sort()
}

/**
 * Last recorded outcome per skill, read from each sidecar index rather than
 * the ledger: cross-repo ledger aggregates are M6, and the index is already
 * the per-skill record.
 */
export async function loadSkillStatuses(
  skills: readonly SkillRef[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const skill of skills) {
    const entries = await readIndex(skill.workspacePath).catch(() => [])
    const newest = entries.reduce<string | null>(
      (max, entry) => (max === null || entry.runId > max ? entry.runId : max),
      null,
    )
    const latest = entries.find((entry) => entry.runId === newest)
    if (latest) out[skill.id] = latest.outcome
  }
  return out
}
