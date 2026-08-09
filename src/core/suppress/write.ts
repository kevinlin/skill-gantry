import { createHash } from 'node:crypto'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { BaselineSpec } from '../adapters/types.js'
import { WRITE_TEMP_NAME } from '../discovery/candidate.js'
import { unifiedDiffFor } from '../isolation/diff.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'
import { appendEntries } from './document.js'

export interface SuppressionPlan {
  toolId: string
  /** Absolute path of the file the rename lands on. */
  path: string
  /** Repo-relative, for the diff label and the pane title. */
  label: string
  /** sha256 of the live file; null when it is absent. */
  preimage: string | null
  tempPath: string
  diff: string
  added: number
  alreadyPresent: number
}

export interface PlanInput {
  skill: SkillRef
  toolId: string
  spec: BaselineSpec
  entries: readonly Record<string, string>[]
  exec?: Exec
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const readOrNull = async (path: string): Promise<string | null> =>
  readFile(path, 'utf8').then(
    (text) => text,
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    },
  )

/** Written through a handle so the bytes are on the platter before the diff. */
async function writeSynced(path: string, text: string): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDir(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Resolves against the **live** skill directory, deliberately unlike §7's
 * conditional-argv stat, which resolves against the tool-facing path. A
 * repo-root skill's tool reads a materialised candidate copy (§4.4), so a write
 * resolved the tool's way would land in a temp directory and be discarded with
 * it. Same token, opposite answer, and it reads as a bug without this comment.
 */
const resolveBaselinePath = (skill: SkillRef, spec: BaselineSpec): string =>
  spec.path.replace(/\{(skillDir|repoRoot)\}/g, (_m, key: string) =>
    key === 'skillDir' ? skill.dir : skill.repo.path,
  )

/**
 * R10.12, first half: nothing the user's repo can see changes here. The staged
 * temp file is both what the diff is computed from and what the rename lands,
 * so the bytes reviewed are the bytes written rather than a second render that
 * could differ.
 */
export async function planSuppression(input: PlanInput): Promise<SuppressionPlan> {
  const { skill, spec, entries, toolId } = input
  const path = resolveBaselinePath(skill, spec)
  const label = relative(skill.repo.path, path)
  const current = await readOrNull(path)
  const preimage = current === null ? null : sha256(current)
  const { text, added, alreadyPresent } = appendEntries(current, spec, entries)
  const tempPath = join(skill.dir, WRITE_TEMP_NAME)

  if (added === 0) {
    return { toolId, path, label, preimage, tempPath, diff: '', added, alreadyPresent }
  }
  await writeSynced(tempPath, text)
  const diff = await unifiedDiffFor(
    current === null ? null : path,
    tempPath,
    label,
    input.exec ?? defaultExec,
  )
  return { toolId, path, label, preimage, tempPath, diff, added, alreadyPresent }
}

/**
 * R10.12, second half. The recheck is R10.11's rule verbatim: a user editing
 * the baseline while the diff sat on screen would otherwise have that edit
 * silently overwritten. An absent preimage that now finds a file is drift too —
 * someone created the baseline under the preview.
 */
export async function applySuppression(plan: SuppressionPlan): Promise<void> {
  const current = await readOrNull(plan.path)
  const now = current === null ? null : sha256(current)
  if (now !== plan.preimage) {
    throw new Error(`preimage-drift: ${plan.label} changed since the diff was built`)
  }
  await rename(plan.tempPath, plan.path)
  await syncDir(dirname(plan.path))
}

export async function discardSuppression(plan: SuppressionPlan): Promise<void> {
  await rm(plan.tempPath, { force: true })
}
