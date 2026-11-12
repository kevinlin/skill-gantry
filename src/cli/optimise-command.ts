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
import { digestSkill } from '../core/discovery/digest.js'
import type { SkillRef } from '../core/types.js'
import { refuse } from './errors.js'
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
 * §8.2's two outcomes that mean no tool in the stage reached a verdict. The set
 * `ledger/gates.ts` steps over, restated here because that module keeps it
 * private and answers from the ledger, which holds an outcome — and this prompt
 * needs the whole `StageResult`.
 */
const NO_VERDICT: ReadonlySet<string> = new Set(['errored', 'skipped'])

type StageEvidence = OptimisePromptInput['evidence'][number]

/**
 * Each stage's evidence across the skill's runs (R6.12, R9.8's rule). A run is
 * whatever stages it was asked for, so the newest run alone lost the eval
 * result recorded one run earlier the moment security was re-run.
 *
 * Walks the index by greatest run id, never by position in the file and never
 * through the `latest` symlink, which is absent mid-write (§14.5). Per stage it
 * takes the first run in which that stage reached a verdict, and when none did
 * the newest run that recorded it at all: a stage that errored every time is
 * still something the agent should be told. A stage no run recorded is absent.
 *
 * A run whose `run.json` is unreadable is skipped, not named: without it there
 * is no digest to say whether the result describes today's files.
 */
async function evidenceFor(skill: SkillRef): Promise<StageEvidence[]> {
  const entries = await readIndex(skill.workspacePath).catch(() => [])
  const newestFirst = [...entries].sort((a, b) =>
    a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0,
  )

  // Read lazily and once: only a run that recorded the stage needs its
  // `run.json`, and the same run answers for several stages.
  const metas = new Map<string, RunMetaOnDisk | null>()
  const metaOf = async (entry: IndexEntry, runDir: string): Promise<RunMetaOnDisk | null> => {
    if (!metas.has(entry.runId)) {
      metas.set(entry.runId, await readJson<RunMetaOnDisk>(join(runDir, 'run.json')))
    }
    return metas.get(entry.runId) ?? null
  }

  const found: Array<Omit<StageEvidence, 'current'>> = []
  for (const [index, stage] of STAGE_ORDER.entries()) {
    let verdict: (typeof found)[number] | null = null
    let newestRecord: (typeof found)[number] | null = null
    for (const entry of newestFirst) {
      const runDir = runDirFor(skill.workspacePath, entry)
      const result = await readJson<StageResult>(
        join(stageDirFor(runDir, index + 1, stage), 'stage.json'),
      )
      if (result === null) continue
      const meta = await metaOf(entry, runDir)
      if (meta === null) continue
      const record = {
        stage,
        result,
        runId: entry.runId,
        runDir,
        skillDigest: meta.skillDigest,
        git: meta.git,
      }
      if (!NO_VERDICT.has(result.outcome)) {
        verdict = record
        break
      }
      newestRecord ??= record
    }
    const chosen = verdict ?? newestRecord
    if (chosen !== null) found.push(chosen)
  }
  if (found.length === 0) return []

  // Once, after the walk: it reads every file the skill ships, and an install
  // with no recorded run has nothing to compare it against.
  const digest = await digestSkill(skill)
  return found.map((record) => ({ ...record, current: record.skillDigest === digest }))
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

  // Read from the sidecar the way `fix-command.ts` does rather than through
  // `loadLastRun`: that one is shaped for the rail — an outcome and flattened
  // FindingRows — and carries neither the whole StageResult nor the digest and
  // git state the prompt names.
  const evidence = await evidenceFor(skill)

  const input: OptimisePromptInput = {
    skill,
    evidence,
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
    return refuse(deps, (err as Error).message, opts.json === true)
  }
  deps.write(opts.json === true ? `${JSON.stringify(plan, null, 2)}\n` : plan.prompt)
  return 0
}
