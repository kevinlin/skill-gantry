import { join } from 'node:path'
import { candidatePolicyFor } from './candidate-policy.js'
import type { SandboxInput } from './git-worktree.js'
import { dirtyPaths, openGitWorktreeSandbox } from './git-worktree.js'
import { MUTATION_COMMANDS, requireCommands } from './preflight.js'
import { openSnapshotSandbox } from './snapshot.js'
import type { MutationSandbox } from './types.js'
import { type Exec, defaultExec } from '../tools/exec.js'
import type { SkillRef } from '../types.js'

/**
 * R10.2 and R10.4 in one call, behind R10.5's single interface. The preflight
 * runs first, because discovering a missing `zip` after the tool has written the
 * live tree leaves a mutation that can be neither packaged nor reviewed, with
 * the marker already claiming it is active.
 */
export async function openSandbox(input: SandboxInput): Promise<MutationSandbox> {
  await requireCommands(MUTATION_COMMANDS, input.exec)
  if (input.skill.repo.isGit) return openGitWorktreeSandbox(input)
  return openSnapshotSandbox({ ...input, snapshotDir: join(input.recordDir, 'snapshot-pre') })
}

/**
 * What `openSandbox` would refuse this scope on, asked before it is opened, so
 * a frontend can offer R10.3's override with the paths on screen rather than as
 * a blind toggle. It decides nothing: the tree can change between this call and
 * the stage, and `openSandbox` asks again.
 *
 * Here rather than in the caller because the strategy question is this module's
 * and this module's only. A caller branching on `repo.isGit` for itself is a
 * second copy of the dispatch above, and the day the snapshot strategy acquires
 * a refusal the preview reports "clean" for a run that will not start.
 */
export async function previewDirtyPaths(
  skill: SkillRef,
  scope: readonly string[],
  exec: Exec = defaultExec,
): Promise<string[]> {
  // Only the git strategy has a working tree to be dirty in; the snapshot
  // strategy copies whatever is there (R10.4) and has nothing to refuse.
  if (!skill.repo.isGit) return []
  return dirtyPaths(skill.repo.path, scope, await candidatePolicyFor(skill), exec)
}
