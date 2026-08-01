import { join } from 'node:path'
import type { Stage } from '../types.js'

export const STAGE_ORDER: readonly Stage[] = [
  'validate',
  'evaluate',
  'security',
  'optimise',
  'release',
]

export const runsRoot = (workspacePath: string): string => join(workspacePath, 'skillgantry', 'runs')

export const indexPath = (workspacePath: string): string =>
  join(runsRoot(workspacePath), 'index.ndjson')

export const latestPath = (workspacePath: string): string => join(runsRoot(workspacePath), 'latest')

export const lockPath = (workspacePath: string): string =>
  join(workspacePath, 'skillgantry', '.lock')

/** Stage directories are numbered by lifecycle position, not execution order. */
export function stageDirFor(runDir: string, index: number, stage: Stage): string {
  return join(runDir, `${String(index).padStart(2, '0')}-${stage}`)
}

export const toolDirFor = (stageDir: string, toolId: string): string => join(stageDir, toolId)
