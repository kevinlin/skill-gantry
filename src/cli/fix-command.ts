import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  STAGE_ORDER,
  buildFixPrompt,
  fixPromptPathFor,
  maxSeverity,
  readIndex,
  runsRoot,
  stageDirFor,
  type StageResult,
} from '../core/index.js'
import type { Severity, SkillRef, Stage } from '../core/types.js'
import { selectSkill, type CliDeps } from './run-command.js'

export interface FixOptions {
  stage?: string
  run?: string
  json?: boolean
}

interface PromptDoc {
  stage: Stage
  path: string
  /** False when the run predates R6.10 and the body was rebuilt in memory. */
  onDisk: boolean
  findings: number
  highestSeverity: Severity
  body: string
}

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

interface RunMetaOnDisk {
  runId: string
  skillDigest: string
  git: { commit: string | null; dirty: boolean }
}

const highestOf = (result: StageResult): Severity =>
  result.toolRuns
    .flatMap((r) => r.findings)
    .reduce<Severity>((acc, f) => maxSeverity(acc, f.severity), 'info')

const stageDirIn = (runDir: string, stage: Stage): string =>
  stageDirFor(runDir, STAGE_ORDER.indexOf(stage) + 1, stage)

/**
 * The greatest run id in `index.ndjson`, not the `latest` symlink — which is
 * absent mid-write — and not the ledger's `runs.sidecar_path`: R8.2 makes the
 * sidecar the evidence, the command already names its skill so no cross-skill
 * query is needed, and a run whose ledger row failed still has complete
 * evidence on disk.
 */
async function resolveRunId(skill: SkillRef, requested: string | undefined): Promise<string> {
  const entries = await readIndex(skill.workspacePath)
  if (requested !== undefined) {
    if (!entries.some((e) => e.runId === requested)) {
      throw new Error(`no run ${requested} recorded for ${skill.id}`)
    }
    return requested
  }
  const newest = entries.reduce<string | null>((max, e) => (max === null || e.runId > max ? e.runId : max), null)
  if (newest === null) throw new Error(`no runs recorded for ${skill.id}`)
  return newest
}

function parseStage(raw: string): Stage {
  if (!STAGE_ORDER.includes(raw as Stage)) throw new Error(`unknown stage: ${raw}`)
  return raw as Stage
}

/**
 * Never writes. The pipeline stays the only writer of `fix-prompt.md`, which is
 * what lets this answer for a run recorded before the prompt existed without
 * rewriting that run's evidence.
 */
async function promptFor(
  skill: SkillRef,
  runDir: string,
  meta: RunMetaOnDisk,
  stage: Stage,
): Promise<PromptDoc | null> {
  const stageDir = stageDirIn(runDir, stage)
  const result = await readJson<StageResult>(join(stageDir, 'stage.json'))
  if (result === null) return null

  const findings = result.toolRuns.flatMap((r) => r.findings).length
  if (findings === 0) return null

  const path = fixPromptPathFor(runDir, stage)
  const stored = await readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  const body =
    stored ??
    buildFixPrompt({
      skill,
      runId: meta.runId,
      stageDir,
      skillDigest: meta.skillDigest,
      git: meta.git,
      result,
    })
  if (body === null) return null

  return {
    stage,
    path,
    onDisk: stored !== null,
    findings,
    highestSeverity: highestOf(result),
    body,
  }
}

export async function runFix(deps: CliDeps, selector: string, opts: FixOptions): Promise<number> {
  const { skill } = await selectSkill(deps.home, selector)
  const runId = await resolveRunId(skill, opts.run)
  const runDir = join(runsRoot(skill.workspacePath), runId)

  const meta = await readJson<RunMetaOnDisk>(join(runDir, 'run.json'))
  if (meta === null) throw new Error(`run ${runId} has no run.json under ${runDir}`)

  const scope = opts.stage === undefined ? STAGE_ORDER : [parseStage(opts.stage)]
  if (opts.stage !== undefined) {
    const stage = scope[0] as Stage
    if ((await readJson(join(stageDirIn(runDir, stage), 'stage.json'))) === null) {
      throw new Error(`run ${runId} did not execute the ${stage} stage`)
    }
  }

  const prompts: PromptDoc[] = []
  for (const stage of scope) {
    const doc = await promptFor(skill, runDir, meta, stage)
    if (doc !== null) prompts.push(doc)
  }

  if (opts.json === true) {
    deps.write(JSON.stringify({ skillId: skill.id, runId, runDir, prompts }))
    return prompts.length > 0 ? 0 : 1
  }

  if (prompts.length === 0) {
    deps.write(`no findings in run ${runId} — nothing to fix`)
    return 1
  }

  // Refusing on ambiguity rather than concatenating two prompts into one, the
  // shape `resolveSkill` already uses: two stages are two jobs for the agent.
  if (prompts.length > 1) {
    for (const doc of prompts) deps.write(`${doc.stage}  ${doc.path}`)
    deps.write('pass --stage <name> to print one')
    return 0
  }

  // The body alone, so `skillgantry fix declawed --stage security | pbcopy` works.
  deps.write((prompts[0] as PromptDoc).body)
  return 0
}
