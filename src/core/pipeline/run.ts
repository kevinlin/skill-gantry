import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolLock } from '../config/schema.js'
import { type Provenance, withAnalysisModes } from '../config/env.js'
import { getAdapter } from '../adapters/registry.js'
import { candidateManifest, materialiseCandidate } from '../discovery/candidate.js'
import { gitState, skillDigest } from '../discovery/digest.js'
import { openSandbox } from '../isolation/open.js'
import { readSandboxRecord } from '../isolation/record.js'
import type { MutationSandbox } from '../isolation/types.js'
import type { Ledger } from '../ledger/db.js'
import { recordRun } from '../ledger/record.js'
import { AdapterStageExecutor } from '../stages/adapter-stage.js'
import { haltsChain, reduceStageMetrics } from '../stages/outcome.js'
import { buildFixPrompt } from '../stages/fix-prompt.js'
import { ReleaseStageExecutor } from '../stages/release-stage.js'
import type {
  PendingMutation,
  ReleaseTarget,
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
} from '../stages/types.js'
import type { SkillRef, Stage, StageOutcome } from '../types.js'
import { STAGE_ORDER } from '../workspace/layout.js'
import {
  claimRunDir,
  ensureGitignore,
  finalizeRun,
  stageDirFor,
  writeFixPrompt,
  writeRunJson,
  writeStageJson,
} from '../workspace/writer.js'
import { Cancellation } from './cancellation.js'
import type { RunEvent } from './events.js'
import { DEFAULT_MUTATION_TIMEOUT_MS, MutationGate } from './mutation-gate.js'
import { AsyncEventQueue } from './queue.js'

/** Test seam and M5 seam: the pipeline never names a concrete executor. */
export type StageExecutorFactory = (stage: Stage) => StageExecutor

/**
 * Callers that pass no executor factory and no ledger — there are none left in
 * this codebase, but the export is kept for callers outside it — get the
 * adapter executor for every stage, `release` included, which throws `unknown
 * tool: release` the moment `AdapterStageExecutor.plan()` runs. `release` has
 * no adapter by design (design §5.1a); reaching this factory for it is a
 * caller that never supplied the ledger a `ReleaseStageExecutor` needs, not a
 * stage `AdapterStageExecutor` can be taught to run.
 */
export const defaultExecutorFactory: StageExecutorFactory = (stage) =>
  new AdapterStageExecutor(stage)

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
  executorFactory?: StageExecutorFactory
  mutationTimeoutMs?: number
  /** R5.2/R12.4: prior authorisation for a mutating stage's write step. */
  authorised?: boolean
  releaseTarget?: ReleaseTarget
  /** R10.3's override, off by default. */
  allowDirty?: boolean
  /** R10.10: supplied by `src/cli/`, the only place that scans workspaces. */
  interrupted?: boolean
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
  /** Resolves once the run has finalised. Calling twice is a no-op. */
  cancel(reason?: string): Promise<void>
  done: Promise<RunSummary>
}

const nowIso = (): string => new Date().toISOString()

/**
 * Rows 3b and 3c of design §8.1: an authorised apply that refused to write, or
 * one that wrote and then could not finish the work that follows it.
 *
 * The synthetic record is **appended** to whatever the tools already reported,
 * never substituted for it. Replacing them threw away the real tool run's
 * findings and its artefact directory, so `stage.json` and the ledger lost the
 * partial evidence R5.13 requires an aborted run to keep.
 */
function abortedStage(
  stage: Stage,
  plan: StagePlan,
  message: string,
  executed?: StageResult,
  errorKind: 'mutation-aborted' | 'mutation-incomplete' = 'mutation-aborted',
): StageResult {
  const toolId = plan.toolIds[0] ?? stage
  return {
    stage,
    outcome: 'errored',
    verdict: executed?.verdict ?? 'passed',
    toolRuns: [
      ...(executed?.toolRuns ?? []),
      {
        toolId,
        toolVersion: null,
        outcome: 'errored',
        exitCode: null,
        durationMs: 0,
        errorKind,
        artefactDir: '',
        findings: [],
        metrics: {},
        summary: message,
      },
    ],
  }
}

export function runPipeline(input: RunPipelineInput): RunHandle {
  const queue = new AsyncEventQueue<RunEvent>()
  const cancellation = new Cancellation()
  // Built per-run rather than reusing `defaultExecutorFactory`: a
  // `ReleaseStageExecutor` needs the ledger (R9.8/R9.9's gate query) and the
  // interrupted flag (R10.10), neither of which a stage-only factory
  // signature can carry.
  const makeExecutor: StageExecutorFactory =
    input.executorFactory ??
    ((stage) =>
      stage === 'release'
        ? new ReleaseStageExecutor({
            ledger: input.ledger,
            ...(input.interrupted === undefined ? {} : { interrupted: input.interrupted }),
          })
        : new AdapterStageExecutor(stage))
  const gate = new MutationGate()
  const mutationTimeoutMs = input.mutationTimeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS

  let observedRunId: string | null = null
  let resolveRunId: (id: string) => void = () => undefined
  const runId: Promise<string> = new Promise((resolve) => {
    resolveRunId = resolve
  })

  const done = (async (): Promise<RunSummary> => {
    const startedAt = nowIso()
    const { runId: id, runDir } = await claimRunDir(input.skill.workspacePath)
    observedRunId = id
    resolveRunId(id)

    // Order matters: R2.12. The gitignore write is itself a change to the repo,
    // so capturing the digest first would record one its own side effect
    // immediately invalidates.
    await ensureGitignore(input.skill.repo.path)
    const manifest = await candidateManifest(input.skill)
    const digest = await skillDigest(manifest)
    const git = await gitState(input.skill.repo.path, input.skill.relPath)

    // R2.11. A repo-root skill keeps its workspace inside the tree a tool would
    // otherwise be pointed at, so the manifest is copied somewhere private and
    // {skillDir} resolves there. Excluding paths after the tool has run is too
    // late: it could already have read a prior unredacted artefact.
    let toolFacingSkill = input.skill
    if (!manifest.selfContained) {
      const dest = await mkdtemp(join(tmpdir(), 'sg-candidate-'))
      await materialiseCandidate(manifest, dest)
      toolFacingSkill = { ...input.skill, dir: dest }
    }

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

    // One object for both sinks. run.json got the resolved provenance and the
    // ledger got the bare one, so a fingerprint over the ledger's copy could
    // not see the analysis-mode boundary R4.2b exists to make visible.
    const provenance = withAnalysisModes(input.provenance, analysisModes)

    await writeRunJson(runDir, {
      runId: id,
      skillId: input.skill.id,
      skillDigest: digest,
      git,
      provenance,
      toolLock: toolLockVersions,
    })

    queue.push({
      type: 'run:start',
      runId: id,
      skillId: input.skill.id,
      stages: input.stages,
      runDir,
    })

    let cancelEmitted = false
    const emitCancelled = (): void => {
      if (cancelEmitted || !cancellation.requested) return
      cancelEmitted = true
      queue.push({
        type: 'run:cancelled',
        runId: id,
        phase: cancellation.phase,
        reason: cancellation.reason,
      })
    }

    /**
     * R5.2's ordering, R5.12's correlation and R5.14's timeout in one place.
     * The diff is emitted before anything is applied, in every mode.
     */
    const gateMutation = async (
      executor: StageExecutor,
      ctx: StageContext,
      plan: StagePlan,
      result: StageResult,
      /** Set the instant the apply starts, so the catch below can tell an
          abort from a failure that happened *after* the tree was written. */
      progress: { applyBegan: boolean },
    ): Promise<StageResult> => {
      if (!executor.mutating || !executor.prepareMutation || !ctx.authorised) return result
      const pending: PendingMutation | null = await executor.prepareMutation(ctx, plan, result)
      if (!pending) {
        // Nothing to approve is not nothing to settle: a sandbox was opened
        // before the tool ran (R10.10), and only apply/discard mark it
        // resolved. Left `active`, a later `skillgantry run` reports it as a
        // crash interrupted mid-mutation, and recovery on the snapshot
        // strategy would restore a pre-tool state over a tree nothing touched.
        await executor.discardMutation?.(ctx, { diff: '', scope: [] })
        return result
      }

      const requestId = randomUUID()
      cancellation.enter('awaiting-approval')
      queue.push({
        type: 'mutation:pending',
        runId: id,
        stage: ctx.stage,
        requestId,
        diff: pending.diff,
        scope: pending.scope,
      })

      // Prompting after cancellation would block on an answer nobody can give.
      const decision = cancellation.requested
        ? ({ action: 'discard', reason: 'cancelled' } as const)
        : await gate.request(requestId, mutationTimeoutMs)

      queue.push({
        type: 'mutation:resolved',
        runId: id,
        stage: ctx.stage,
        requestId,
        action: decision.action,
      })
      cancellation.enter('running')

      if (decision.action === 'apply') {
        progress.applyBegan = true
        await executor.applyMutation?.(ctx, pending)
        return result
      }
      await executor.discardMutation?.(ctx, pending)
      // An unapplied mutating stage did not do its job, whatever its tools
      // reported, so it cannot report `passed` and cannot continue the chain.
      return { ...result, outcome: 'skipped' }
    }

    // Stages always run in lifecycle order regardless of the order requested.
    const ordered = STAGE_ORDER.filter((s) => input.stages.includes(s))
    const results: StageResult[] = []
    let outcome: StageOutcome = 'passed'

    cancellation.enter('running')
    for (const stage of ordered) {
      if (cancellation.requested) break

      const executor = makeExecutor(stage)
      const stageDir = stageDirFor(runDir, STAGE_ORDER.indexOf(stage) + 1, stage)

      const ctx0: StageContext = {
        skill: toolFacingSkill,
        stage,
        stageDir,
        runDir,
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
        signal: cancellation.signal,
        authorised: input.authorised === true,
        ...(input.releaseTarget === undefined ? {} : { releaseTarget: input.releaseTarget }),
        ...(input.allowDirty === undefined ? {} : { allowDirty: input.allowDirty }),
      }

      const stageStartedAt = nowIso()

      // Stamped here rather than in each executor: `abortedStage` builds a
      // StageResult too, and three call sites remembering to fill the same
      // three fields is three chances for a stage to reach the ledger with a
      // span that is not its own.
      const stamp = (settled: StageResult): StageResult => ({
        ...settled,
        metrics: reduceStageMetrics(settled.toolRuns),
        startedAt: stageStartedAt,
        endedAt: nowIso(),
      })

      const plan = await executor.plan(ctx0)
      queue.push({ type: 'stage:start', runId: id, stage, toolIds: plan.toolIds })
      for (const toolId of plan.toolIds) {
        queue.push({ type: 'tool:start', runId: id, stage, toolId })
      }

      let sandbox: MutationSandbox | undefined
      let openFailure: string | null = null
      if (executor.mutating && input.authorised === true && plan.mutationScope.paths.length > 0) {
        try {
          sandbox = await openSandbox({
            skill: input.skill,
            stage,
            runId: id,
            recordDir: runDir,
            scope: plan.mutationScope.paths,
            ...(input.allowDirty === undefined ? {} : { allowDirty: input.allowDirty }),
          })
        } catch (err) {
          // A sandbox that will not open is row 3b: nothing was written, and the
          // stage has to say why rather than rejecting the whole run.
          openFailure = (err as Error).message
        }
      }

      const ctx: StageContext = {
        ...ctx0,
        // {skillDir} and {repoRoot} follow the sandbox, which is what makes the
        // tool write the copy rather than the user's tree (design §7).
        ...(sandbox
          ? {
              skill: {
                ...toolFacingSkill,
                dir: sandbox.resolve(input.skill.relPath),
                repo: { ...input.skill.repo, path: sandbox.workRoot },
              },
            }
          : {}),
        ...(sandbox ? { sandbox } : {}),
      }

      if (openFailure !== null) {
        const result = stamp(abortedStage(stage, plan, `sandbox: ${openFailure}`))
        await writeStageJson(stageDir, result)
        results.push(result)
        queue.push({ type: 'stage:done', runId: id, stage, outcome: result.outcome, result })
        outcome = result.outcome
        break
      }

      // execute() lives inside this try too: a sandbox opens above, and a
      // release-stage executor (Task 11) is free to throw out of execute()
      // the same way an apply can abort out of gateMutation. Either way the
      // finally has to run to settle the sandbox — a throw that skipped it
      // would leave the worktree registered and the record `active` forever.
      let executed: StageResult | undefined
      let result: StageResult
      const progress = { applyBegan: false }
      try {
        executed = await executor.execute(ctx, plan)
        for (const toolRun of executed.toolRuns) {
          queue.push({ type: 'tool:done', runId: id, stage, toolId: toolRun.toolId, result: toolRun })
        }
        result = stamp(await gateMutation(executor, ctx, plan, executed, progress))
      } catch (err) {
        // No sandbox means this stage never touched isolation (not mutating,
        // or not authorised), so there is nothing of row 3b's to report —
        // the error is the run's, same as before this task.
        if (!sandbox) throw err
        // `applyBegan` alone is too coarse: R10.11's drift check runs *inside*
        // the apply and throws before a byte moves, which is row 3b. The
        // sandbox record is the authority on whether the write landed — both
        // strategies mark it `applied` only after `applyJournalled` has
        // completed the journal.
        const landed =
          progress.applyBegan && (await readSandboxRecord(runDir))?.state === 'applied'
        if (landed) {
          // Row 3c. The apply already ran, so this is not an abort and must not
          // be settled like one: design §12.4 gives an at-or-after-apply
          // failure a *compensating journal rollback*, and a completed journal
          // has nothing left to compensate. Calling `discardMutation` here
          // flipped a git sandbox's marker to `discarded` over a tree written
          // with a complete journal — so recovery would never offer it again —
          // and, on the snapshot strategy, restored the pre-tool state over an
          // apply the user had approved.
          result = stamp(
            abortedStage(stage, plan, (err as Error).message, executed, 'mutation-incomplete'),
          )
        } else {
          // Row 3b. R10.11 aborts an authorised apply on drift, and R5.13 requires
          // the run to finalise anyway so its partial evidence survives.
          await executor.discardMutation?.(ctx, { diff: '', scope: [] }).catch(() => undefined)
          result = stamp(abortedStage(stage, plan, (err as Error).message, executed))
        }
      } finally {
        await sandbox?.dispose()
      }

      // stage.json records redacted:false per tool run (R7.4a); an adapter that
      // declares `binaryArtefacts` has them copied verbatim by the runner, not
      // here.
      await writeStageJson(stageDir, result)

      // R6.10. The prompt names where a coding agent should edit, so it takes
      // `input.skill` and not `ctx.skill`: the latter points into the mutation
      // sandbox or into the materialised candidate's temp dir, neither of which
      // survives this call.
      const fixPrompt = buildFixPrompt({
        skill: input.skill,
        runId: id,
        stageDir,
        skillDigest: digest,
        git,
        result,
      })
      if (fixPrompt !== null) await writeFixPrompt(stageDir, fixPrompt)

      results.push(result)
      queue.push({ type: 'stage:done', runId: id, stage, outcome: result.outcome, result })

      outcome = result.outcome
      if (haltsChain(result.outcome)) break
    }

    // A run cancelled before any stage produced a result did not do what it was
    // asked, and there is no 'cancelled' stage outcome to report it with.
    if (cancellation.requested && results.length === 0) outcome = 'errored'
    emitCancelled()

    cancellation.enter('finalising')
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
      provenanceJson: JSON.stringify(provenance),
      toolLockJson: JSON.stringify(toolLockVersions),
      sidecarPath: runDir,
      stages: results,
    })

    cancellation.enter('done')
    // A request that arrived while finalisation was in flight is acknowledged
    // here: design §11.4 makes that phase uncancellable, not unreportable.
    emitCancelled()

    queue.push({ type: 'run:done', runId: id, outcome, ...delta })
    queue.close()

    return { runId: id, runDir, outcome, skillDigest: digest, stages: results, ...delta }
  })()

  done.catch((err: unknown) => {
    queue.push({
      type: 'run:error',
      runId: observedRunId ?? 'unknown',
      message: (err as Error).message,
    })
    queue.close()
  })

  return {
    runId,
    events: queue,
    resolveMutation: (requestId, action) => {
      gate.resolve(requestId, action)
    },
    cancel: async (reason = 'cancelled by caller') => {
      cancellation.request(reason)
      // A run parked on a prompt has no other way back to the finaliser.
      gate.discardAll('cancelled')
      await done.then(
        () => undefined,
        () => undefined,
      )
    },
    done,
  }
}
