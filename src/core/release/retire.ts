import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { v7 as uuidv7 } from 'uuid'
import { openSandbox } from '../isolation/open.js'
import type { ChangeSet } from '../isolation/types.js'
import type { Exec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'
import { setDeprecated } from './frontmatter-edit.js'

export interface RetireInput {
  skill: SkillRef
  deprecated: boolean
  supersededBy?: string
  /** Answers the diff. R5.2 holds here as it does for a mutating stage. */
  confirm: (change: ChangeSet) => Promise<boolean>
  allowDirty?: boolean
  exec?: Exec
}

export interface RetireResult {
  applied: boolean
  recordDir: string
  scope: string[]
  diff: string
}

/**
 * R1.4 and design §13. Not a stage — `Stage` is a closed union of five and
 * retirement is metadata-only — but the write is a mutation, so it takes the
 * same declared scope, preview, confirmation and journal.
 *
 * The record lives under `retire/<id>/` rather than a run directory so Task 6's
 * scan finds an interrupted retirement with no special case.
 */
export async function retireSkill(input: RetireInput): Promise<RetireResult> {
  const relPath = input.skill.relPath === '.' ? 'SKILL.md' : `${input.skill.relPath}/SKILL.md`
  const id = uuidv7()
  const recordDir = join(input.skill.workspacePath, 'skillgantry', 'retire', id)
  await mkdir(recordDir, { recursive: true })

  const sandbox = await openSandbox({
    skill: input.skill,
    stage: 'retire',
    runId: id,
    recordDir,
    scope: [relPath],
    // R10.3: the override is the *user's* decision, not retirement's to make
    // for them — a chained retire/undo without one is refused exactly like
    // any other mutation over an uncommitted scope path, and `--allow-dirty`
    // stays the one way past that refusal.
    ...(input.allowDirty === undefined ? {} : { allowDirty: input.allowDirty }),
    ...(input.exec === undefined ? {} : { exec: input.exec }),
  })

  try {
    const path = sandbox.resolve(relPath)
    const source = await readFile(path, 'utf8')
    const edited = setDeprecated(
      source,
      input.deprecated,
      ...(input.supersededBy === undefined ? [] : [input.supersededBy]),
    )
    if (edited !== source) await writeFile(path, edited)

    const change = await sandbox.changeSet()
    if (change.entries.length === 0) {
      await sandbox.discard()
      return { applied: false, recordDir, scope: [], diff: '' }
    }

    const scope = change.entries.map((entry) => entry.path)
    if (!(await input.confirm(change))) {
      await sandbox.discard()
      return { applied: false, recordDir, scope, diff: change.unifiedDiff }
    }

    await sandbox.apply(change)
    return { applied: true, recordDir, scope, diff: change.unifiedDiff }
  } finally {
    await sandbox.dispose()
  }
}
