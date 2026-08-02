import { join } from 'node:path'
import type { SandboxInput } from './git-worktree.js'
import { openGitWorktreeSandbox } from './git-worktree.js'
import { MUTATION_COMMANDS, requireCommands } from './preflight.js'
import { openSnapshotSandbox } from './snapshot.js'
import type { MutationSandbox } from './types.js'

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
