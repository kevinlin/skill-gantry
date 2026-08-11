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

/**
 * A run directory is named for its start time so `ls` answers "when" without
 * opening five `run.json` files. Local time, not UTC: the name exists to be
 * recognised by the person who started the run, and `run.json` already carries
 * an unambiguous ISO instant. The clock is the caller's — the pipeline has
 * `startedAt` before it claims the directory.
 */
export function runDirName(startedAt: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const date = `${startedAt.getFullYear()}-${p(startedAt.getMonth() + 1)}-${p(startedAt.getDate())}`
  const time = `${p(startedAt.getHours())}-${p(startedAt.getMinutes())}-${p(startedAt.getSeconds())}`
  return `${date}_${time}`
}

/**
 * The directory a recorded run lives in. An entry written before the directory
 * name was recorded carries no `dir`, and back then the basename *was* the run
 * id — so the fallback is not a guess, it is that era's rule.
 */
export const runDirFor = (workspacePath: string, entry: { runId: string; dir?: string }): string =>
  join(runsRoot(workspacePath), entry.dir ?? entry.runId)

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

/**
 * The pipeline writes it, the CLI reads it and the TUI copies it, so the
 * filename lives beside `stageDirFor` — which already has `STAGE_ORDER` in
 * scope — rather than in three callers that could disagree.
 */
export const fixPromptPathFor = (runDir: string, stage: Stage): string =>
  join(stageDirFor(runDir, STAGE_ORDER.indexOf(stage) + 1, stage), 'fix-prompt.md')
