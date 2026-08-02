import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SkillRef } from '../types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import { readJournal, rollbackJournal } from './journal.js'
import { markSandboxRecord, scanSandboxRecords } from './record.js'
import { restoreSnapshot } from './snapshot.js'
import type { SandboxRecord } from './types.js'

export interface InterruptedMutation {
  record: SandboxRecord
  /** Absolute path to the run or retire directory holding the record. */
  recordDir: string
  skillId: string
  journalIncomplete: boolean
}

const recordDirFor = (record: SandboxRecord, workspacePath: string): string => {
  const group = record.stage === 'retire' ? 'retire' : 'runs'
  return join(workspacePath, 'skillgantry', group, record.runId)
}

/**
 * The inverse of `recordDirFor`: `<workspacePath>/skillgantry/<group>/<runId>`
 * strips to `workspacePath` in three `dirname` steps. Recovery reconstructs it
 * from the record alone (no discovery re-run), which is what lets
 * `restoreInterrupted` take just an `InterruptedMutation` and still call
 * `restoreSnapshot`, whose signature requires a `SkillRef`.
 */
const workspacePathOf = (recordDir: string): string => dirname(dirname(dirname(recordDir)))

/**
 * `restoreSnapshot` reads only `skill.repo.path` and `skill.workspacePath` off
 * the `SkillRef` it is given — the rest of the shape exists purely to satisfy
 * the type. Recovery has no live `SkillRef` (a record can outlive the run that
 * discovered it), so this rebuilds just those two fields from the record and
 * its directory rather than re-running discovery.
 */
const skillFor = (found: InterruptedMutation): SkillRef => ({
  id: found.skillId,
  name: null,
  version: null,
  dir: '',
  relPath: '',
  rootSkill: false,
  repo: { id: '', path: found.record.repoPath, name: '', isGit: false },
  workspacePath: workspacePathOf(found.recordDir),
})

/**
 * R10.10. A `SnapshotSandbox` lets the tool write the real tree, so a crash
 * during the mutating tool or while a diff awaited approval leaves the skill
 * partially modified with no journal — the journal only exists from apply
 * onward, which is exactly why the record is written before the tool starts.
 */
export async function scanInterrupted(
  skills: readonly SkillRef[],
): Promise<InterruptedMutation[]> {
  const found: InterruptedMutation[] = []
  for (const skill of skills) {
    for (const record of await scanSandboxRecords(skill.workspacePath)) {
      const recordDir = recordDirFor(record, skill.workspacePath)
      const journal = await readJournal(recordDir)
      found.push({
        record,
        recordDir,
        skillId: skill.id,
        journalIncomplete: journal !== null && !journal.complete,
      })
    }
  }
  return found
}

/**
 * Journal first, snapshot second. An incomplete journal holds the bytes as they
 * were immediately before the apply, which is later evidence than the snapshot
 * taken before the tool ran, and restoring the older copy would discard changes
 * the user had already approved.
 */
export async function restoreInterrupted(
  found: InterruptedMutation,
  exec: Exec = defaultExec,
): Promise<string[]> {
  const restored = await rollbackJournal(found.recordDir)
  if (restored.length > 0) {
    await markSandboxRecord(found.recordDir, 'discarded')
    return restored
  }

  if (found.record.strategy === 'git-worktree') {
    // The user's tree was never touched, so recovery is a prune. Anything odd
    // in the tree predates us and is not ours to revert.
    await markSandboxRecord(found.recordDir, 'discarded')
    // A `git-worktree` sandbox always opens its work root as a fresh
    // `mkdtemp` under the system temp dir (`git-worktree.ts`), distinct from
    // `repoPath` by construction. A record where the two coincide is
    // malformed, and recovery refuses to `rm -rf` it — the one guard that
    // stops a corrupted marker from taking the user's repo down with it.
    if (found.record.workRoot !== found.record.repoPath) {
      await rm(found.record.workRoot, { recursive: true, force: true })
      await exec('git', ['worktree', 'prune'], { cwd: found.record.repoPath }).catch(() => undefined)
    }
    return []
  }

  await restoreSnapshot(found.record.snapshotDir, skillFor(found), found.record.scope)
  await markSandboxRecord(found.recordDir, 'discarded')
  return [...found.record.scope]
}

/** Keeps the tree as it stands and stops the record being reported again. */
export async function forgetInterrupted(found: InterruptedMutation): Promise<void> {
  await markSandboxRecord(found.recordDir, 'discarded')
}
