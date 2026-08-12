import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SkillRef } from '../types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import { readJournal, rollbackJournal, sweepApplyTemps } from './journal.js'
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

/**
 * What each branch of `restoreInterrupted` actually did. A bare path list could
 * not tell "the apply had already completed, the tree stands as approved" apart
 * from "nothing was ever written" — both are empty — and the CLI printed the
 * second sentence for the first case, on the one command a user reaches after a
 * crash.
 */
export type RecoveryAction = 'settled-applied' | 'rolled-back' | 'pruned' | 'restored'

export interface RecoveryOutcome {
  action: RecoveryAction
  /** Paths put back; empty for `settled-applied` and `pruned`. */
  paths: string[]
}

/**
 * `<workspacePath>/skillgantry/<group>/<dir>` strips to `workspacePath` in three
 * `dirname` steps — depth, never the name, which is why a run directory named
 * for its start time changes nothing here. Recovery derives the workspace from
 * the scanned directory (no discovery re-run), which is what lets
 * `restoreInterrupted` take just an `InterruptedMutation` and still call
 * `restoreSnapshot`, whose signature requires a `SkillRef`.
 */
const workspacePathOf = (recordDir: string): string => dirname(dirname(dirname(recordDir)))

/**
 * `restoreSnapshot` reads `repo.path`, `workspacePath`, and — since it filters
 * the live side through the candidate manifest — `dir`, `relPath` and
 * `rootSkill`. Recovery has no live `SkillRef` (a record can outlive the run
 * that discovered it), which is exactly why the record carries the last three:
 * a rebuilt ref with `relPath: ''` would make the manifest walk speak for the
 * wrong root, and the restore delete files it never backed up.
 */
const skillFor = (found: InterruptedMutation): SkillRef => {
  const relPath = found.record.skillRelPath
  return {
    id: found.skillId,
    name: null,
    version: null,
    dir: relPath === '.' || relPath === '' ? found.record.repoPath : join(found.record.repoPath, relPath),
    relPath: relPath === '' ? '.' : relPath,
    rootSkill: found.record.rootSkill,
    repo: { id: '', path: found.record.repoPath, name: '', isGit: false },
    workspacePath: workspacePathOf(found.recordDir),
    deprecated: false,
    supersededBy: null,
    // No frontmatter was read here, so nothing observed it failing. `false`
    // would be a claim about a file this path never opened.
    frontmatterReadable: true,
  }
}

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
    for (const { record, dir: recordDir } of await scanSandboxRecords(skill.workspacePath)) {
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
 *
 * A *complete* journal is a third case, distinct from "no journal at all":
 * `openSnapshotSandbox.apply` calls `applyJournalled` (which durably marks the
 * journal complete) and only then `markSandboxRecord(recordDir, 'applied')`. A
 * crash between those two lines leaves an `active` record sitting over a
 * finished apply — `rollbackJournal` correctly does nothing for it (there is
 * nothing to compensate), but treating that the same as "apply never started"
 * would fall through to a full snapshot restore and discard a mutation the
 * user already approved. Recovery's job here is to settle the record, not
 * undo the apply.
 */
export async function restoreInterrupted(
  found: InterruptedMutation,
  exec: Exec = defaultExec,
): Promise<RecoveryOutcome> {
  const journal = await readJournal(found.recordDir)
  // Before either journal branch: a crash between `writeAtomic`'s temp file and
  // its rename leaves `<target>.sg-tmp` inside the candidate root, where it
  // changes every later digest and so blocks the next release.
  if (journal) await sweepApplyTemps(journal)

  if (journal?.complete) {
    await markSandboxRecord(found.recordDir, 'applied')
    return { action: 'settled-applied', paths: [] }
  }

  if (journal && !journal.complete) {
    const restored = await rollbackJournal(found.recordDir)
    await markSandboxRecord(found.recordDir, 'discarded')
    return { action: 'rolled-back', paths: restored }
  }

  if (found.record.strategy === 'git-worktree') {
    // The user's tree was never touched, so recovery is a prune. Anything odd
    // in the tree predates us and is not ours to revert. Mark the record only
    // after the prune succeeds, matching the other two branches: a crash
    // mid-prune should leave the record `active` so a later scan finds the
    // worktree again, rather than settling the record over a leaked directory
    // nothing will ever revisit.
    // A `git-worktree` sandbox always opens its work root as a fresh
    // `mkdtemp` under the system temp dir (`git-worktree.ts`), distinct from
    // `repoPath` by construction. A record where the two coincide is
    // malformed, and recovery refuses to `rm -rf` it — the one guard that
    // stops a corrupted marker from taking the user's repo down with it.
    if (found.record.workRoot !== found.record.repoPath) {
      await rm(found.record.workRoot, { recursive: true, force: true })
      await exec('git', ['worktree', 'prune'], { cwd: found.record.repoPath }).catch(() => undefined)
    }
    await markSandboxRecord(found.recordDir, 'discarded')
    return { action: 'pruned', paths: [] }
  }

  await restoreSnapshot(found.record.snapshotDir, skillFor(found), found.record.scope)
  await markSandboxRecord(found.recordDir, 'discarded')
  return { action: 'restored', paths: [...found.record.scope] }
}

/** Keeps the tree as it stands and stops the record being reported again. */
export async function forgetInterrupted(found: InterruptedMutation): Promise<void> {
  await markSandboxRecord(found.recordDir, 'discarded')
}
