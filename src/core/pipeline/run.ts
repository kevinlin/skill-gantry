import type { ToolLock } from '../config/schema.js'
import { type Provenance, withAnalysisModes } from '../config/env.js'
import { getAdapter } from '../adapters/registry.js'
import { gitState, digestSkill } from '../discovery/digest.js'
import type { Ledger } from '../ledger/db.js'
import { recordRun } from '../ledger/record.js'
import { AdapterStageExecutor } from '../stages/adapter-stage.js'
import { haltsChain } from '../stages/outcome.js'
import type { StageContext, StageResult } from '../stages/types.js'
import type { SkillRef, Stage, StageOutcome } from '../types.js'
import { STAGE_ORDER } from '../workspace/layout.js'
import {
  claimRunDir,
  ensureGitignore,
  finalizeRun,
  stageDirFor,
  writeRunJson,
  writeStageJson,
} from '../workspace/writer.js'
import type { RunEvent } from './events.js'
import { AsyncEventQueue } from './queue.js'

export interface RunPipelineInput {
  skill: SkillRef
  stages: readonly Stage[]
  trigger: string
  stageTools: Readonly<Partial<Record<Stage, readonly string[]>>>
  lock: ToolLock
  ledger: Ledger
  env: NodeJS.ProcessEnv
  secrets: readonly string[]
  provenance: Provenance
  artefactSizeCapBytes: number
  timeoutOverridesMs: Readonly<Record<string, number>>
}

export interface RunSummary {
  runId: string
  runDir: string
  outcome: StageOutcome
  skillDigest: string
  stages: StageResult[]
  opened: number
  closed: number
  reopened: number
}

export interface RunHandle {
  runId: Promise<string>
  events: AsyncIterable<RunEvent>
  resolveMutation(requestId: string, action: 'apply' | 'discard'): void
  cancel(reason?: string): void
  done: Promise<RunSummary>
}

const nowIso = (): string => new Date().toISOString()

export function runPipeline(input: RunPipelineInput): RunHandle {
  const queue = new AsyncEventQueue<RunEvent>()
  const controller = new AbortController()
  const pendingMutations = new Map<string, (action: 'apply' | 'discard') => void>()

  let resolveRunId: (id: string) => void = () => undefined
  const runId: Promise<string> = new Promise((resolve) => {
    resolveRunId = resolve
  })

  const done = (async (): Promise<RunSummary> => {
    const startedAt = nowIso()
    const { runId: id, runDir } = await claimRunDir(input.skill.workspacePath)
    resolveRunId(id)

    // Order matters: R2.12. The gitignore write is itself a change to the repo,
    // so capturing the digest first would record one its own side effect
    // immediately invalidates.
    await ensureGitignore(input.skill.repo.path)
    const digest = await digestSkill(input.skill)
    const git = await gitState(input.skill.repo.path, input.skill.relPath)

    const toolLockVersions = Object.fromEntries(
      Object.entries(input.lock.tools).map(([toolId, entry]) => [toolId, entry.resolvedVersion]),
    )

    // A tool's analysis mode changes what its numbers mean, so it is recorded
    // beside the provider fingerprint that exists for the same reason (R4.2b).
    const analysisModes: Record<string, string> = {}
    for (const stage of input.stages) {
      for (const toolId of input.stageTools[stage] ?? []) {
        const adapter = getAdapter(toolId)
        if (adapter) analysisModes[toolId] = adapter.manifest.analysisMode
      }
    }

    await writeRunJson(runDir, {
      runId: id,
      skillId: input.skill.id,
      skillDigest: digest,
      git,
      provenance: withAnalysisModes(input.provenance, analysisModes),
      toolLock: toolLockVersions,
    })

    queue.push({
      type: 'run:start',
      runId: id,
      skillId: input.skill.id,
      stages: input.stages,
      runDir,
    })

    // Stages always run in lifecycle order regardless of the order requested.
    const ordered = STAGE_ORDER.filter((s) => input.stages.includes(s))
    const results: StageResult[] = []
    let outcome: StageOutcome = 'passed'

    for (const stage of ordered) {
      const executor = new AdapterStageExecutor(stage)
      const stageDir = stageDirFor(runDir, STAGE_ORDER.indexOf(stage) + 1, stage)

      const ctx: StageContext = {
        skill: input.skill,
        stage,
        stageDir,
        selectedToolIds: input.stageTools[stage] ?? [],
        lock: input.lock,
        env: input.env,
        secrets: input.secrets,
        artefactSizeCapBytes: input.artefactSizeCapBytes,
        timeoutOverridesMs: input.timeoutOverridesMs,
        onOutput: (toolId, stream, chunk) => {
          if (chunk.length > 0) {
            queue.push({ type: 'tool:output', runId: id, stage, toolId, stream, chunk })
          }
        },
        signal: controller.signal,
      }

      const plan = await executor.plan(ctx)
      queue.push({ type: 'stage:start', runId: id, stage, toolIds: plan.toolIds })
      for (const toolId of plan.toolIds) {
        queue.push({ type: 'tool:start', runId: id, stage, toolId })
      }

      const result = await executor.execute(ctx, plan)
      for (const toolRun of result.toolRuns) {
        queue.push({ type: 'tool:done', runId: id, stage, toolId: toolRun.toolId, result: toolRun })
      }

      // M1's only adapter declares no binaryArtefacts, so nothing is copied
      // verbatim; stage.json still records redacted:false per tool run (R7.4a).
      await writeStageJson(stageDir, result)

      results.push(result)
      queue.push({ type: 'stage:done', runId: id, stage, outcome: result.outcome, result })

      outcome = result.outcome
      if (haltsChain(result.outcome)) break
    }

    const endedAt = nowIso()
    await finalizeRun(input.skill.workspacePath, { runId: id, outcome, endedAt })

    const delta = recordRun(input.ledger, {
      skill: input.skill,
      runId: id,
      trigger: input.trigger,
      startedAt,
      endedAt,
      outcome,
      skillDigest: digest,
      git,
      provenanceJson: JSON.stringify(input.provenance),
      toolLockJson: JSON.stringify(toolLockVersions),
      sidecarPath: runDir,
      stages: results,
    })

    queue.push({ type: 'run:done', runId: id, outcome, ...delta })
    queue.close()

    return { runId: id, runDir, outcome, skillDigest: digest, stages: results, ...delta }
  })()

  done.catch((err: unknown) => {
    queue.push({ type: 'run:error', runId: 'unknown', message: (err as Error).message })
    queue.close()
  })

  return {
    runId,
    events: queue,
    resolveMutation: (requestId, action) => pendingMutations.get(requestId)?.(action),
    cancel: (reason = 'cancelled by caller') => {
      controller.abort()
      queue.push({ type: 'run:cancelled', runId: 'unknown', reason })
    },
    done,
  }
}
