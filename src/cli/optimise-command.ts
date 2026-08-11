import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SKILLHONE_TOOL_ID,
  STAGE_ORDER,
  buildOptimisePrompt,
  loadToolLock,
  readIndex,
  runDirFor,
  stageDirFor,
  type IndexEntry,
  type OptimisePromptInput,
  type StageResult,
} from '../core/index.js'
import type { SkillRef, Stage } from '../core/types.js'
import { selectSkill, type CliDeps } from './run-command.js'
import { evalAssetsOf } from './skill-evals.js'

interface RunMetaOnDisk {
  runId: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
}

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * The greatest run id in the index, never the `latest` symlink, which is absent
 * mid-write — §14.5's resolution rule, and `fix-command.ts`'s. The entry, not
 * the id: the run's directory is named for its start time, so the index is what
 * maps one to the other.
 */
const newestRun = async (skill: SkillRef): Promise<IndexEntry | null> => {
  const entries = await readIndex(skill.workspacePath).catch(() => [])
  return entries.reduce<IndexEntry | null>(
    (max, entry) => (max === null || entry.runId > max.runId ? entry : max),
    null,
  )
}

export interface OptimisePlan {
  skill: SkillRef
  prompt: string
  missing: readonly string[]
}

/**
 * The one assembly, shared by the port and the subcommand, so the pane and the
 * headless output can never disagree about what was handed over.
 */
export async function planOptimiseFor(home: string, skill: SkillRef): Promise<OptimisePlan> {
  const lock = await loadToolLock(home)
  const entry = lock.tools[SKILLHONE_TOOL_ID]
  if (entry === undefined) {
    throw new Error(`${SKILLHONE_TOOL_ID} is not installed — run \`skillgantry setup\``)
  }

  const missing: string[] = []
  try {
    await access(entry.bin)
  } catch {
    missing.push('the managed interpreter')
  }

  // Read the sidecar the way `fix-command.ts` does rather than through
  // `loadLastRun`: that one is shaped for the rail — LastRunStage carries an
  // outcome and flattened FindingRows — and carries neither the digest nor the
  // git state R6.12 requires the prompt to name.
  const newest = await newestRun(skill)
  let lastRun: OptimisePromptInput['lastRun'] = null
  if (newest !== null) {
    const runId = newest.runId
    const runDir = runDirFor(skill.workspacePath, newest)
    const meta = await readJson<RunMetaOnDisk>(join(runDir, 'run.json'))
    if (meta !== null) {
      const stages: Array<{ stage: Stage; result: StageResult }> = []
      for (const [index, stage] of STAGE_ORDER.entries()) {
        const result = await readJson<StageResult>(
          join(stageDirFor(runDir, index + 1, stage), 'stage.json'),
        )
        // A run executes the stages it was asked for, so an absent summary is
        // the ordinary case for the others rather than a failed read.
        if (result !== null) stages.push({ stage, result })
      }
      lastRun = { runId, runDir, skillDigest: meta.skillDigest, git: meta.git, stages }
    }
  }

  const input: OptimisePromptInput = {
    skill,
    lastRun,
    evalAssets: await evalAssetsOf(skill),
    install: {
      interpreter: entry.bin,
      // The first recorded link is the runtime directory a maintainer will
      // recognise; the bin is the fallback when SkillHone was already present
      // and no link was ours to make.
      skillsDir: entry.links?.[0] ?? entry.bin,
      sha: entry.resolvedVersion,
      missing,
    },
  }
  return { skill, prompt: buildOptimisePrompt(input), missing }
}

export interface OptimiseOptions {
  json?: boolean
}

export async function runOptimise(
  deps: CliDeps,
  selector: string,
  opts: OptimiseOptions,
): Promise<number> {
  const { skill } = await selectSkill(deps.home, selector)
  let plan: OptimisePlan
  try {
    plan = await planOptimiseFor(deps.home, skill)
  } catch (err) {
    deps.write(`${(err as Error).message}\n`)
    return 2
  }
  deps.write(opts.json === true ? `${JSON.stringify(plan, null, 2)}\n` : plan.prompt)
  return 0
}
