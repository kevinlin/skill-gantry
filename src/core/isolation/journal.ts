import type { Exec } from '../tools/exec.js'
import type { ChangeSet } from './types.js'

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature only; Task 5 implements the body
export async function applyJournalled(_input: ApplyInput): Promise<void> {
  throw new Error('not implemented: plan-m5 Task 5')
}
