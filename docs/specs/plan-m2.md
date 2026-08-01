# SkillGantry M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** revision 1, aligned to [design.md](design.md) revision 3, [requirements.md](requirements.md) revision 3 and [plan-m1.md](plan-m1.md) revision 2.

**Goal:** Put a queue and a terminal interface over the M1 engine — batch enqueue with a bounded worker pool, a command path that cancels and resolves, and a Work screen that renders live state without holding log text in React.

**Architecture:** M2 adds two modules to `src/core` (`queue`, plus cancellation and the mutation gate inside `pipeline`) and the whole of `src/tui`. No M1 call site is rewritten, and `skillgantry run` keeps its exit codes and its JSON stream.

**Tech Stack:** everything M1 ships, plus Ink 6 and React 19 for the terminal interface, and `tsx` as a dev dependency so tests can run engine code in a second process.

## Global Constraints

Everything in [plan-m1.md's Global Constraints](plan-m1.md) still holds. These are the additions.

- The import boundary gains a rule: `src/tui/**` imports core **only** through `src/core/index.ts`. Deep imports such as `../core/ledger/db.js` fail `pnpm lint`. This is R13.1 applied to the new consumer.
- `src/tui/**` may touch the filesystem. It may not spawn processes or open the ledger; those belong to `src/cli/tui-command.ts`, which owns the wiring.
- Log text never enters React state line by line. Chunks go to a ring buffer held outside the component tree and a fixed-interval tick copies the visible window into state. This is R11.4, and the reducer test asserts it by dispatching a `tool:output` event and expecting no state change.
- Ring buffer capacity is 2000 lines, flush interval 100 ms, both from design §14.
- Every change to a file M1 created is **additive**. An added optional parameter, an added optional interface method, an added union member field, a new export. If a change would break an M1 call site, it is out of scope for M2.
- Mutating stages are `optimise` and `release`. M2 ships neither. It ships the gate, the timeout and the serialisation they will use, tested against fake executors, because R5.7, R5.13 and R5.14 are M2-owned and cannot wait for M5.
- Cancellation has four phases and exactly four: `queued` (owned by the queue), `running`, `awaiting-approval`, `finalising` (owned by the pipeline). A cancelled run still finalises.
- JSX is `react-jsx`. Relative imports in `.tsx` carry the `.js` extension like everywhere else under `NodeNext`.
- Every commit message uses Conventional Commits.

## Working against M1

M1 is being implemented in a separate worktree. Where a task below shows a whole M1 file, it shows that file **as plan-m1 specifies it, with the M2 change applied**. If the shipped file has drifted from plan-m1, apply the described change to the shipped file rather than pasting over it. Each task states its change in prose before the code for exactly this reason.

Two M1 behaviours M2 depends on, both verified in plan-m1's own tests:

1. `runTool` already accepts an `AbortSignal`, kills the process **group** on abort, and returns `cancelled: true`. `classifyToolRun` already maps that to `errored` with `error_kind = 'cancelled'`, which does not reconcile. So cancelling a running tool needs no new kill path — only a pipeline that survives it.
2. `withSkillLock` already carries a pid and a stale threshold, and `finalizeRun` already defines `latest` as the greatest run id. M1 tests both **in one process**. R6.7 and R6.9 are M2-owned because one process shares a lock table and a file descriptor table, so an in-process test cannot prove either. M2 proves them across real processes and logs the reclaim, which M1's no-op callback does not.

## One M1 behaviour M2 must change

`AdapterStageExecutor` calls `ctx.onOutput(toolId, 'stdout', run.stdout)` **once, after the tool exits**, with the whole capture. A frontend fed that way sees nothing until the tool finishes, so R11.4's "live tool output" and its 10,000-lines-in-5-seconds acceptance test are both unsatisfiable. Task 6 adds an optional `onChunk` to `runTool` and forwards it, so `tool:output` events arrive while the tool runs. The `StageContext.onOutput` signature does not change; only its call frequency does. Task 6 states the consequence for the headless CLI, which ignores `tool:output` either way.

## File structure

```
src/
  core/
    index.ts                    MODIFIED  queue, stage and workspace-read exports
    config/
      schema.ts                 MODIFIED  mutationTimeoutMs
      config.ts                 MODIFIED  DEFAULT_CONFIG.mutationTimeoutMs
    pipeline/
      cancellation.ts           NEW       RunPhase, CancelPhase, Cancellation
      mutation-gate.ts          NEW       MutationGate, MutationDecision
      events.ts                 MODIFIED  phase on run:cancelled, scope on mutation:pending
      run.ts                    MODIFIED  cancellation, mutation gate, executor factory
    queue/
      types.ts                  NEW       JobSpec, JobRecord, QueueEvent, QueueHandle
      pool.ts                   NEW       createQueue()
    runner/
      spawn.ts                  MODIFIED  onChunk
    stages/
      types.ts                  MODIFIED  PendingMutation, optional mutation methods
      adapter-stage.ts          MODIFIED  forward chunks as they arrive
    workspace/
      writer.ts                 MODIFIED  reclaim reason, reclaim log
  tui/
    index.tsx                   renderApp()
    app.tsx                     App: event subscription, input, pump ownership
    store.ts                    AppState, reducer, initialState
    log-buffer.ts               RingBuffer, LogPump
    views.ts                    loadSkillMd, listArtefacts, loadSkillStatuses
    components/
      SkillList.tsx
      LifecycleRail.tsx
      OutputPane.tsx
      QueuePanel.tsx
      Work.tsx
  cli/
    index.ts                    MODIFIED  root options, default action
    run-command.ts              MODIFIED  --concurrency, default action
    tui-command.ts              NEW       config -> queue -> renderApp
tests/
  helpers/
    fake-executor.ts            NEW
    fake-run.ts                 NEW
    child.ts                    NEW
    render-ink.tsx              NEW
  core/
    pipeline-cancel.test.ts     mutation-gate.test.ts     pipeline-mutation.test.ts
    queue.test.ts               queue-cancel.test.ts      workspace-concurrency.test.ts
    streaming.test.ts
  tui/
    log-buffer.test.ts          store.test.ts             work-screen.test.tsx
    output-pane.test.tsx        queue-panel.test.tsx      app-batch.test.tsx
  acceptance/
    m2.test.ts
```

---

### Task 1: Cancellation across the pipeline's three phases

**Files:**
- Create: `src/core/pipeline/cancellation.ts`
- Create: `tests/helpers/fake-executor.ts`
- Modify: `src/core/pipeline/events.ts`, `src/core/pipeline/run.ts`
- Test: `tests/core/pipeline-cancel.test.ts`

**Interfaces:**
- Consumes: `runPipeline`, `RunHandle`, `RunSummary`, `RunEvent` (M1 Task 18); `StageExecutor`, `StageContext`, `StagePlan`, `StageResult` (M1 Task 14); `finalizeRun`, `writeStageJson` (M1 Task 15).
- Produces: `RunPhase`, `CancelPhase`, `reportPhase(phase)`, `class Cancellation`; `StageExecutorFactory`, `defaultExecutorFactory`; `RunPipelineInput.executorFactory?`; `RunHandle.cancel` now returns `Promise<void>` that resolves after finalisation; `run:cancelled` gains `phase`.
- Produces the test helper `fakeExecutor(stage, options)` used by Tasks 2, 3 and 14.

M1's `cancel()` aborts a controller and pushes `run:cancelled` with the string `'unknown'` as the run id. Nothing waits for the run to settle, nothing records which phase was interrupted, and a cancelled run may abandon its evidence. R5.13 requires the opposite in every phase: the run finalises, so its partial evidence survives.

`cancel` returning `Promise<void>` is source-compatible with M1's `void`: a function returning a promise is assignable where a void return is expected, and no M1 caller invokes `cancel` at all.

- [ ] **Step 1: Write the failing test**

`tests/helpers/fake-executor.ts`:

```ts
import type {
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
} from '../../src/core/stages/types.js'
import type { Stage, StageOutcome, ToolOutcome } from '../../src/core/types.js'

export interface FakeExecutorOptions {
  /** Stage outcome to report. Defaults to 'passed'. */
  outcome?: StageOutcome
  toolOutcome?: ToolOutcome
  mutating?: boolean
  /** Awaited inside execute(), so a test can hold a stage open. */
  hold?: Promise<void>
  /** Records each call in order. Task 2 adds the mutation calls. */
  calls?: string[]
}

/**
 * A StageExecutor with no subprocess. The pipeline's sequencing, gating and
 * cancellation are decisions, and a decision is easier to prove against a
 * fake stage than against a shell script pretending to be a scanner.
 */
export function fakeExecutor(stage: Stage, options: FakeExecutorOptions = {}): StageExecutor {
  const calls = options.calls ?? []
  const outcome = options.outcome ?? 'passed'
  const toolOutcome = options.toolOutcome ?? (outcome === 'failed' ? 'failed' : 'passed')

  return {
    stage,
    mutating: options.mutating ?? false,

    async plan(_ctx: StageContext): Promise<StagePlan> {
      return {
        toolIds: ['fake'],
        policy: options.mutating === true ? 'pick-one' : 'fan-out',
        mutationScope: { paths: options.mutating === true ? [`${stage}/SKILL.md`] : [] },
      }
    },

    async execute(ctx: StageContext, _plan: StagePlan): Promise<StageResult> {
      calls.push(`execute:${stage}`)
      ctx.onOutput('fake', 'stdout', `${stage} running\n`)
      if (options.hold) await options.hold
      return {
        stage,
        outcome,
        verdict: outcome === 'failed' ? 'failed' : 'passed',
        toolRuns: [
          {
            toolId: 'fake',
            toolVersion: '0.0.0',
            outcome: toolOutcome,
            exitCode: 0,
            durationMs: 1,
            errorKind: null,
            artefactDir: `${ctx.stageDir}/fake`,
            findings: [],
            metrics: { durationMs: 1 },
            summary: `${stage} fake`,
          },
        ],
      }
    },
  }
}
```

The helper has no mutation hooks yet: `PendingMutation` and the optional
executor methods land in Task 2, which extends this file rather than rewriting
it.

`tests/core/pipeline-cancel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline, type RunPipelineInput } from '../../src/core/pipeline/run.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import { withSkillLock } from '../../src/core/workspace/writer.js'
import type { SkillRef } from '../../src/core/types.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { fakeExecutor } from '../helpers/fake-executor.js'

const SARIF_EMPTY = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'skillspector', version: '2.3.7' } }, results: [] }],
})

async function setup(script: string): Promise<{ skill: SkillRef; input: RunPipelineInput }> {
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0') } })
  const repo = { id: 'fx', path: repoPath, name: 'fx', isGit: false }
  const [skill] = await discoverSkills(repo)
  const bin = await makeFakeTool('skillspector', script)
  return {
    skill: skill!,
    input: {
      skill: skill!,
      stages: ['security'],
      trigger: 'test',
      stageTools: { security: ['skillspector'] },
      lock: {
        version: 1,
        tools: {
          skillspector: {
            installKind: 'uv-tool',
            requestedPin: '2.3.7',
            resolvedVersion: '2.3.7',
            bin,
            integrity: 'n/a',
            installedAt: '2026-08-01T00:00:00Z',
            verifiedAt: '2026-08-01T00:00:00Z',
          },
        },
      },
      ledger: openLedger(':memory:'),
      env: {},
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
      artefactSizeCapBytes: 1024 * 1024,
      timeoutOverridesMs: {},
    },
  }
}

async function collect(events: AsyncIterable<RunEvent>, sink: RunEvent[]): Promise<void> {
  for await (const event of events) sink.push(event)
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe('cancelling while a tool is running', () => {
  it('kills the tool, reports the phase and still finalises', async () => {
    const { skill, input } = await setup('echo starting; sleep 600')
    const seen: RunEvent[] = []
    const handle = runPipeline(input)
    const draining = collect(handle.events, seen)

    // Wait until the tool has actually started before cancelling.
    while (!seen.some((e) => e.type === 'tool:start')) {
      await new Promise((r) => setTimeout(r, 10))
    }
    await handle.cancel('user pressed x')
    await draining
    const summary = await handle.done

    const cancelled = seen.find((e) => e.type === 'run:cancelled')
    expect(cancelled).toMatchObject({ phase: 'running', reason: 'user pressed x' })
    expect(cancelled?.type === 'run:cancelled' && cancelled.runId).toBe(summary.runId)

    const toolRun = summary.stages[0]?.toolRuns[0]
    expect(toolRun).toMatchObject({ outcome: 'errored', errorKind: 'cancelled' })

    // R5.13: the evidence survives.
    expect(await exists(join(summary.runDir, '03-security', 'stage.json'))).toBe(true)
    const index = await readFile(
      join(skill.workspacePath, 'skillgantry/runs/index.ndjson'),
      'utf8',
    )
    expect(index.trim().split('\n')).toHaveLength(1)

    const runs = input.ledger.db.prepare('select count(*) as n from runs').get() as { n: number }
    expect(runs.n).toBe(1)
    input.ledger.close()
  })

  it('resolves cancel() only after the run has finalised', async () => {
    const { skill, input } = await setup('sleep 600')
    const handle = runPipeline(input)
    const draining = collect(handle.events, [])
    await new Promise((r) => setTimeout(r, 100))

    await handle.cancel()
    // The index line is written inside finalisation, so its presence at this
    // point is the proof that cancel() waited.
    expect(await exists(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'))).toBe(true)

    await draining
    await handle.done
    input.ledger.close()
  })

  it('is idempotent', async () => {
    const { input } = await setup('sleep 600')
    const seen: RunEvent[] = []
    const handle = runPipeline(input)
    const draining = collect(handle.events, seen)
    await new Promise((r) => setTimeout(r, 100))

    await Promise.all([handle.cancel('first'), handle.cancel('second')])
    await draining
    await handle.done

    const cancelled = seen.filter((e) => e.type === 'run:cancelled')
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]).toMatchObject({ reason: 'first' })
    input.ledger.close()
  })
})

describe('cancelling around the stage loop', () => {
  it('finalises a run cancelled before its first stage', async () => {
    const { input } = await setup('exit 0')
    const seen: RunEvent[] = []
    const handle = runPipeline({ ...input, executorFactory: (s) => fakeExecutor(s) })
    const cancelling = handle.cancel('too soon')
    const draining = collect(handle.events, seen)
    await cancelling
    await draining
    const summary = await handle.done

    expect(summary.stages).toHaveLength(0)
    expect(summary.outcome).toBe('errored')
    expect(seen.some((e) => e.type === 'stage:start')).toBe(false)
    expect(seen.at(-1)?.type).toBe('run:done')
    input.ledger.close()
  })

  it('does not start the stages that follow the cancelled one', async () => {
    const { input } = await setup('exit 0')
    const seen: RunEvent[] = []
    let release!: () => void
    const hold = new Promise<void>((r) => {
      release = r
    })
    const handle = runPipeline({
      ...input,
      stages: ['validate', 'security'],
      stageTools: { validate: ['fake'], security: ['fake'] },
      executorFactory: (s) => fakeExecutor(s, s === 'validate' ? { hold } : {}),
    })
    const draining = collect(handle.events, seen)

    while (!seen.some((e) => e.type === 'stage:start')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    const cancelling = handle.cancel('stop')
    release()
    await cancelling
    await draining

    const started = seen.filter((e) => e.type === 'stage:start')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ stage: 'validate' })
    input.ledger.close()
  })
})

describe('cancelling during finalisation', () => {
  it('completes finalisation and reports the finalising phase', async () => {
    const { skill, input } = await setup('exit 0')
    const seen: RunEvent[] = []

    // Holding the per-skill lock parks the pipeline inside finalizeRun, which
    // is the only deterministic way to observe that phase.
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const holding = withSkillLock(skill.workspacePath, () => held, 30_000)
    await new Promise((r) => setTimeout(r, 20))

    const handle = runPipeline({ ...input, executorFactory: (s) => fakeExecutor(s) })
    const draining = collect(handle.events, seen)
    while (!seen.some((e) => e.type === 'stage:done')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    await new Promise((r) => setTimeout(r, 20))

    const cancelling = handle.cancel('late')
    release()
    await holding
    await cancelling
    await draining
    const summary = await handle.done

    expect(seen.find((e) => e.type === 'run:cancelled')).toMatchObject({ phase: 'finalising' })
    expect(seen.at(-1)?.type).toBe('run:done')
    expect(summary.stages).toHaveLength(1)
    const index = await readFile(
      join(skill.workspacePath, 'skillgantry/runs/index.ndjson'),
      'utf8',
    )
    expect(index.trim().split('\n')).toHaveLength(1)
    input.ledger.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/pipeline-cancel.test.ts`
Expected: FAIL — `executorFactory` is not a known input, `run:cancelled` has no `phase`, `cancel` returns `void` so `await handle.cancel()` resolves before finalisation.

- [ ] **Step 3: Write the cancellation state**

`src/core/pipeline/cancellation.ts`:

```ts
/** Where the pipeline is. 'starting' and 'done' are windows, not phases. */
export type RunPhase = 'starting' | 'running' | 'awaiting-approval' | 'finalising' | 'done'

/** The four phases R5.13 names. 'queued' belongs to the queue, not to a run. */
export type CancelPhase = 'queued' | 'running' | 'awaiting-approval' | 'finalising'

/**
 * The pre-first-stage window is reported as 'running' and the post-finalisation
 * window as 'finalising', so every cancellation lands on one of the four phases
 * a frontend is written against.
 */
export function reportPhase(phase: RunPhase): CancelPhase {
  if (phase === 'starting') return 'running'
  if (phase === 'done') return 'finalising'
  return phase
}

export class Cancellation {
  readonly #controller = new AbortController()
  #phase: RunPhase = 'starting'
  #reason: string | null = null
  #at: RunPhase | null = null

  get signal(): AbortSignal {
    return this.#controller.signal
  }

  get requested(): boolean {
    return this.#reason !== null
  }

  get reason(): string {
    return this.#reason ?? ''
  }

  /** The phase the pipeline was in when cancellation was requested. */
  get phase(): CancelPhase {
    return reportPhase(this.#at ?? this.#phase)
  }

  enter(phase: RunPhase): void {
    this.#phase = phase
  }

  /** First request wins, so a double cancel yields one event and one reason. */
  request(reason: string): boolean {
    if (this.#reason !== null) return false
    this.#reason = reason
    this.#at = this.#phase
    this.#controller.abort()
    return true
  }
}
```

- [ ] **Step 4: Add the phase to the event**

In `src/core/pipeline/events.ts`, add the import and replace the `run:cancelled` member:

```ts
import type { CancelPhase } from './cancellation.js'
```

```ts
  | { type: 'run:cancelled'; runId: string; phase: CancelPhase; reason: string }
```

- [ ] **Step 5: Rewrite the pipeline around the cancellation**

`src/core/pipeline/run.ts` — the whole file, with M1's body preserved and the cancellation woven through it:

```ts
import type { ToolLock } from '../config/schema.js'
import { type Provenance, withAnalysisModes } from '../config/env.js'
import { getAdapter } from '../adapters/registry.js'
import { gitState, digestSkill } from '../discovery/digest.js'
import type { Ledger } from '../ledger/db.js'
import { recordRun } from '../ledger/record.js'
import { AdapterStageExecutor } from '../stages/adapter-stage.js'
import { haltsChain } from '../stages/outcome.js'
import type { StageContext, StageExecutor, StageResult } from '../stages/types.js'
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
import { Cancellation } from './cancellation.js'
import type { RunEvent } from './events.js'
import { AsyncEventQueue } from './queue.js'

/** Test seam and M5 seam: the pipeline never names a concrete executor. */
export type StageExecutorFactory = (stage: Stage) => StageExecutor

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

export function runPipeline(input: RunPipelineInput): RunHandle {
  const queue = new AsyncEventQueue<RunEvent>()
  const cancellation = new Cancellation()
  const makeExecutor = input.executorFactory ?? defaultExecutorFactory
  const pendingMutations = new Map<string, (action: 'apply' | 'discard') => void>()

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
    const digest = await digestSkill(input.skill)
    const git = await gitState(input.skill.repo.path, input.skill.relPath)

    const toolLockVersions = Object.fromEntries(
      Object.entries(input.lock.tools).map(([toolId, entry]) => [toolId, entry.resolvedVersion]),
    )

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

    // Stages always run in lifecycle order regardless of the order requested.
    const ordered = STAGE_ORDER.filter((s) => input.stages.includes(s))
    const results: StageResult[] = []
    let outcome: StageOutcome = 'passed'

    cancellation.enter('running')
    for (const stage of ordered) {
      if (cancellation.requested) break

      const executor = makeExecutor(stage)
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
        signal: cancellation.signal,
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

      // R7.4a: no adapter declares binaryArtefacts yet, so the map is empty and
      // stage.json still records `redacted: false` for every tool run.
      const unredacted = Object.fromEntries(
        result.toolRuns.map((run) => [run.toolId, [] as string[]]),
      )
      await writeStageJson(stageDir, result, unredacted)

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
      provenanceJson: JSON.stringify(input.provenance),
      toolLockJson: JSON.stringify(toolLockVersions),
      sidecarPath: runDir,
      stages: results,
    })

    cancellation.enter('done')
    // A request that arrived while finalisation was in flight is acknowledged
    // here: §11.4 makes that phase uncancellable, not unreportable.
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
    resolveMutation: (requestId, action) => pendingMutations.get(requestId)?.(action),
    cancel: async (reason = 'cancelled by caller') => {
      cancellation.request(reason)
      await done.then(
        () => undefined,
        () => undefined,
      )
    },
    done,
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/pipeline-cancel.test.ts tests/core/pipeline.test.ts`
Expected: PASS, six new cases plus M1's nine. M1's suite must stay green: the executor factory defaults to `AdapterStageExecutor`, so nothing M1 wrote changes behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/core/pipeline tests/core/pipeline-cancel.test.ts tests/helpers/fake-executor.ts
git commit -m "feat(pipeline): cancel in any phase and still finalise the run"
```

---

### Task 2: Mutation gate with a correlation id and a timeout

**Files:**
- Create: `src/core/pipeline/mutation-gate.ts`
- Modify: `src/core/stages/types.ts`, `src/core/pipeline/events.ts`, `src/core/pipeline/run.ts`, `src/core/config/schema.ts`, `src/core/config/config.ts`, `tests/helpers/fake-executor.ts`
- Test: `tests/core/mutation-gate.test.ts`, `tests/core/pipeline-mutation.test.ts`

**Interfaces:**
- Consumes: `Cancellation` (Task 1), `fakeExecutor` (Task 1), `StageExecutor`/`StageResult` (M1 Task 14).
- Produces: `MutationAction`, `MutationDecision`, `class MutationGate`; `PendingMutation` and the optional `prepareMutation` / `applyMutation` / `discardMutation` on `StageExecutor`; `RunPipelineInput.mutationTimeoutMs?`; `DEFAULT_MUTATION_TIMEOUT_MS`; `mutation:pending` gains `scope`; `GantryConfig.mutationTimeoutMs`.

This is R5.12's resolve half and R5.14 whole. M2 ships no mutating stage, so the gate is proven against `fakeExecutor`. M5 supplies real `prepareMutation`, `applyMutation` and `discardMutation` implementations and changes nothing here.

Three decisions worth stating, because each is a policy rather than a mechanism:

**A mutation that is not applied makes its stage `skipped`.** §11.4 says so for cancellation. M2 applies it to discard and to timeout as well, because the alternative is a stage reporting `passed` while nothing was written, which reads as a successful optimise that silently did nothing. `haltsChain('skipped')` is true, so the chain stops there.

**The timeout discards, it does not apply.** R5.14. An unattended prompt is a decision not taken, and the safe reading of a decision not taken is "do not write to the user's repo".

**Cancellation pre-empts the gate.** If cancellation was already requested when the gate is reached, the pipeline does not emit a prompt nobody can answer; it discards immediately.

- [ ] **Step 1: Write the failing test**

`tests/core/mutation-gate.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MutationGate } from '../../src/core/pipeline/mutation-gate.js'

describe('MutationGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the user action', async () => {
    const gate = new MutationGate()
    const pending = gate.request('r1', 1_000)
    expect(gate.resolve('r1', 'apply')).toBe(true)
    await expect(pending).resolves.toEqual({ action: 'apply', reason: 'user' })
  })

  it('discards on timeout — R5.14', async () => {
    const gate = new MutationGate()
    const pending = gate.request('r1', 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toEqual({ action: 'discard', reason: 'timeout' })
  })

  it('ignores a resolution for an unknown or already settled request', async () => {
    const gate = new MutationGate()
    const pending = gate.request('r1', 1_000)
    gate.resolve('r1', 'apply')
    await pending
    expect(gate.resolve('r1', 'discard')).toBe(false)
    expect(gate.resolve('nope', 'apply')).toBe(false)
  })

  it('discards everything outstanding on demand', async () => {
    const gate = new MutationGate()
    const one = gate.request('r1', 1_000)
    const two = gate.request('r2', 1_000)
    gate.discardAll('cancelled')
    await expect(one).resolves.toEqual({ action: 'discard', reason: 'cancelled' })
    await expect(two).resolves.toEqual({ action: 'discard', reason: 'cancelled' })
    expect(gate.pendingIds).toEqual([])
  })

  it('clears the timer when a request is resolved', async () => {
    const gate = new MutationGate()
    const pending = gate.request('r1', 1_000)
    gate.resolve('r1', 'apply')
    await pending
    await vi.advanceTimersByTimeAsync(5_000)
    expect(gate.pendingIds).toEqual([])
  })
})
```

`tests/core/pipeline-mutation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline, type RunPipelineInput } from '../../src/core/pipeline/run.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { fakeExecutor } from '../helpers/fake-executor.js'

const PENDING = { diff: '--- a/SKILL.md\n+++ b/SKILL.md\n@@\n-old\n+new\n', scope: ['declawed/SKILL.md'] }

async function setup(): Promise<RunPipelineInput> {
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0') } })
  const [skill] = await discoverSkills({ id: 'fx', path: repoPath, name: 'fx', isGit: false })
  return {
    skill: skill!,
    stages: ['optimise'],
    trigger: 'test',
    stageTools: { optimise: ['fake'] },
    lock: { version: 1, tools: {} },
    ledger: openLedger(':memory:'),
    env: {},
    secrets: [],
    provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
    artefactSizeCapBytes: 1024 * 1024,
    timeoutOverridesMs: {},
  }
}

async function collect(events: AsyncIterable<RunEvent>, sink: RunEvent[]): Promise<void> {
  for await (const event of events) sink.push(event)
}

describe('mutation gating', () => {
  it('emits a correlated prompt and applies on approval — R5.12', async () => {
    const input = await setup()
    const calls: string[] = []
    const seen: RunEvent[] = []
    const handle = runPipeline({
      ...input,
      executorFactory: (s) => fakeExecutor(s, { mutating: true, pending: PENDING, calls }),
    })

    const draining = (async () => {
      for await (const event of handle.events) {
        seen.push(event)
        if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'apply')
      }
    })()
    await draining
    const summary = await handle.done

    const prompt = seen.find((e) => e.type === 'mutation:pending')
    expect(prompt).toMatchObject({ stage: 'optimise', diff: PENDING.diff, scope: PENDING.scope })
    expect(prompt?.type === 'mutation:pending' && prompt.requestId).toMatch(/[0-9a-f-]{36}/)
    expect(seen.find((e) => e.type === 'mutation:resolved')).toMatchObject({ action: 'apply' })
    expect(calls).toEqual(['execute:optimise', 'apply:optimise'])
    expect(summary.outcome).toBe('passed')
    input.ledger.close()
  })

  it('discards on rejection and marks the stage skipped', async () => {
    const input = await setup()
    const calls: string[] = []
    const handle = runPipeline({
      ...input,
      executorFactory: (s) => fakeExecutor(s, { mutating: true, pending: PENDING, calls }),
    })
    for await (const event of handle.events) {
      if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'discard')
    }
    const summary = await handle.done

    expect(calls).toEqual(['execute:optimise', 'discard:optimise'])
    expect(summary.stages[0]?.outcome).toBe('skipped')
    input.ledger.close()
  })

  it('times out, discards and still finalises — R5.14', async () => {
    const input = await setup()
    const calls: string[] = []
    const seen: RunEvent[] = []
    const handle = runPipeline({
      ...input,
      mutationTimeoutMs: 120,
      executorFactory: (s) => fakeExecutor(s, { mutating: true, pending: PENDING, calls }),
    })
    await collect(handle.events, seen)
    const summary = await handle.done

    expect(seen.find((e) => e.type === 'mutation:resolved')).toMatchObject({ action: 'discard' })
    expect(calls).toEqual(['execute:optimise', 'discard:optimise'])
    expect(summary.stages[0]?.outcome).toBe('skipped')
    expect(seen.at(-1)?.type).toBe('run:done')
    input.ledger.close()
  })

  it('cancelling while awaiting approval discards and reports the phase', async () => {
    const input = await setup()
    const calls: string[] = []
    const seen: RunEvent[] = []
    const handle = runPipeline({
      ...input,
      mutationTimeoutMs: 60_000,
      executorFactory: (s) => fakeExecutor(s, { mutating: true, pending: PENDING, calls }),
    })
    const draining = collect(handle.events, seen)
    while (!seen.some((e) => e.type === 'mutation:pending')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    await handle.cancel('user quit')
    await draining
    const summary = await handle.done

    expect(seen.find((e) => e.type === 'run:cancelled')).toMatchObject({
      phase: 'awaiting-approval',
    })
    expect(calls).toEqual(['execute:optimise', 'discard:optimise'])
    expect(summary.stages[0]?.outcome).toBe('skipped')
    input.ledger.close()
  })

  it('does not prompt when the stage produced no mutation', async () => {
    const input = await setup()
    const seen: RunEvent[] = []
    const handle = runPipeline({
      ...input,
      executorFactory: (s) => fakeExecutor(s, { mutating: true, pending: null }),
    })
    await collect(handle.events, seen)
    await handle.done
    expect(seen.some((e) => e.type === 'mutation:pending')).toBe(false)
    input.ledger.close()
  })

  it('never loops back to validate after optimise — R5.4', async () => {
    const input = await setup()
    const seen: RunEvent[] = []
    const handle = runPipeline({
      ...input,
      executorFactory: (s) => fakeExecutor(s, { mutating: true, pending: PENDING }),
    })
    const draining = (async () => {
      for await (const event of handle.events) {
        seen.push(event)
        if (event.type === 'mutation:pending') handle.resolveMutation(event.requestId, 'apply')
      }
    })()
    await draining
    await handle.done

    expect(seen.filter((e) => e.type === 'stage:start').map((e) => e.stage)).toEqual(['optimise'])
    expect(seen.at(-1)?.type).toBe('run:done')
    input.ledger.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/mutation-gate.test.ts tests/core/pipeline-mutation.test.ts`
Expected: FAIL — module not found, and `prepareMutation` is not part of `StageExecutor`.

- [ ] **Step 3: Write the gate**

`src/core/pipeline/mutation-gate.ts`:

```ts
export type MutationAction = 'apply' | 'discard'

export interface MutationDecision {
  action: MutationAction
  reason: 'user' | 'timeout' | 'cancelled'
}

/** R5.14's interval. Overridable per run and in config.json. */
export const DEFAULT_MUTATION_TIMEOUT_MS = 300_000

/**
 * Correlates a prompt with its answer. The pipeline blocks on `request`; a
 * frontend answers with `resolve` off the back of a `mutation:pending` event.
 * Nothing here writes: the gate decides, the executor acts.
 */
export class MutationGate {
  readonly #pending = new Map<string, (decision: MutationDecision) => void>()

  get pendingIds(): string[] {
    return [...this.#pending.keys()]
  }

  request(requestId: string, timeoutMs: number): Promise<MutationDecision> {
    return new Promise<MutationDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.#settle(requestId, { action: 'discard', reason: 'timeout' })
      }, timeoutMs)
      // A pending prompt must not hold the process open on its own.
      timer.unref?.()
      this.#pending.set(requestId, (decision) => {
        clearTimeout(timer)
        resolve(decision)
      })
    })
  }

  resolve(requestId: string, action: MutationAction): boolean {
    return this.#settle(requestId, { action, reason: 'user' })
  }

  discardAll(reason: 'cancelled' | 'timeout' = 'cancelled'): void {
    for (const requestId of this.pendingIds) {
      this.#settle(requestId, { action: 'discard', reason })
    }
  }

  #settle(requestId: string, decision: MutationDecision): boolean {
    const settle = this.#pending.get(requestId)
    if (!settle) return false
    this.#pending.delete(requestId)
    settle(decision)
    return true
  }
}
```

- [ ] **Step 4: Add the executor's mutation hooks**

Append to `src/core/stages/types.ts`:

```ts
export interface PendingMutation {
  /** Unified diff for preview. Empty when the change set is binary-only. */
  diff: string
  /** Repo-relative paths this mutation would write. */
  scope: readonly string[]
}
```

and extend `StageExecutor` with three optional members, leaving the two required ones untouched so `AdapterStageExecutor` still satisfies the interface unchanged:

```ts
export interface StageExecutor {
  readonly stage: Stage
  readonly mutating: boolean
  plan(ctx: StageContext): Promise<StagePlan>
  execute(ctx: StageContext, plan: StagePlan): Promise<StageResult>
  /** Mutating executors only. Null means the tools changed nothing. */
  prepareMutation?(
    ctx: StageContext,
    plan: StagePlan,
    result: StageResult,
  ): Promise<PendingMutation | null>
  applyMutation?(ctx: StageContext, pending: PendingMutation): Promise<void>
  discardMutation?(ctx: StageContext, pending: PendingMutation): Promise<void>
}
```

Then extend `tests/helpers/fake-executor.ts` so it can play a mutating stage.
Add `PendingMutation` to its type import, add one option:

```ts
  /** Returned by prepareMutation. Null means the tools changed nothing. */
  pending?: PendingMutation | null
```

and add three members to the returned object, after `execute`:

```ts
    async prepareMutation(): Promise<PendingMutation | null> {
      return options.pending ?? null
    },

    async applyMutation(): Promise<void> {
      calls.push(`apply:${stage}`)
    },

    async discardMutation(): Promise<void> {
      calls.push(`discard:${stage}`)
    },
```

- [ ] **Step 5: Carry the scope on the event**

In `src/core/pipeline/events.ts`, replace the `mutation:pending` member:

```ts
  | {
      type: 'mutation:pending'
      runId: string
      stage: Stage
      requestId: string
      diff: string
      scope: readonly string[]
    }
```

- [ ] **Step 6: Add the timeout to config**

In `src/core/config/schema.ts`, add one field to `configSchema`:

```ts
  /** R5.14: a prompt nobody answers discards after this long. */
  mutationTimeoutMs: z.number().int().min(1_000).default(300_000),
```

and in `src/core/config/config.ts`, add the matching default to `DEFAULT_CONFIG`:

```ts
  mutationTimeoutMs: 300_000,
```

The zod default means an existing `config.json` written by M1 still parses.

- [ ] **Step 7: Gate the mutating stage in the pipeline**

In `src/core/pipeline/run.ts`, add `randomUUID` and the gate, and widen the
existing `../stages/types.js` type import to cover `PendingMutation` and
`StagePlan`:

```ts
import { randomUUID } from 'node:crypto'
import type {
  PendingMutation,
  StageContext,
  StageExecutor,
  StagePlan,
  StageResult,
} from '../stages/types.js'
import { DEFAULT_MUTATION_TIMEOUT_MS, MutationGate } from './mutation-gate.js'
```

add one input field:

```ts
  mutationTimeoutMs?: number
```

replace the `pendingMutations` map with the gate, inside `runPipeline`:

```ts
  const gate = new MutationGate()
  const mutationTimeoutMs = input.mutationTimeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS
```

add this function inside the `done` IIFE, after `emitCancelled` is defined:

```ts
    /**
     * R5.2's ordering, R5.12's correlation and R5.14's timeout in one place.
     * The diff is emitted before anything is applied, in every mode.
     */
    const gateMutation = async (
      executor: StageExecutor,
      ctx: StageContext,
      plan: StagePlan,
      result: StageResult,
    ): Promise<StageResult> => {
      if (!executor.mutating || !executor.prepareMutation) return result
      const pending: PendingMutation | null = await executor.prepareMutation(ctx, plan, result)
      if (!pending) return result

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
        await executor.applyMutation?.(ctx, pending)
        return result
      }
      await executor.discardMutation?.(ctx, pending)
      // An unapplied mutating stage did not do its job, whatever its tools
      // reported, so it cannot report `passed` and cannot continue the chain.
      return { ...result, outcome: 'skipped' }
    }
```

then in the stage loop, put the gate between `execute` and the write:

```ts
      const executed = await executor.execute(ctx, plan)
      for (const toolRun of executed.toolRuns) {
        queue.push({ type: 'tool:done', runId: id, stage, toolId: toolRun.toolId, result: toolRun })
      }

      const result = await gateMutation(executor, ctx, plan, executed)
```

and point `resolveMutation` at the gate, adding the wake-up to `cancel`:

```ts
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/mutation-gate.test.ts tests/core/pipeline-mutation.test.ts tests/core/pipeline-cancel.test.ts`
Expected: PASS, eleven new cases plus Task 1's six.

- [ ] **Step 9: Commit**

```bash
git add src/core/pipeline src/core/stages/types.ts src/core/config \
        tests/core/mutation-gate.test.ts tests/core/pipeline-mutation.test.ts
git commit -m "feat(pipeline): gate mutating stages on a correlated, timed prompt"
```

---

### Task 3: Bounded worker pool with batch enqueue

**Files:**
- Create: `src/core/queue/types.ts`, `src/core/queue/pool.ts`, `tests/helpers/fake-run.ts`
- Modify: `src/core/index.ts`
- Test: `tests/core/queue.test.ts`

**Interfaces:**
- Consumes: `RunHandle`, `RunSummary`, `RunEvent` (Task 1), `AsyncEventQueue` (M1 Task 18), `SkillRef`, `Stage`, `StageOutcome` (M1 Task 2).
- Produces: `JobSpec`, `JobState`, `JobRecord`, `QueueSnapshot`, `QueueEvent`, `QueueHandle`, `MUTATING_STAGES`, `isMutatingJob(stages)`, `QueueOptions`, `createQueue(options)`.
- Produces the test helper `fakeRun(runId)` used by Tasks 4, 12 and 14.

`createQueue` takes `startRun` as an injected function rather than reaching for config and the ledger itself. The queue's job is scheduling; the wiring belongs to `src/cli/tui-command.ts` (Task 13). That also makes every scheduling rule below testable with no subprocess.

**Scheduling rule.** Jobs start in enqueue order, except that a job containing a mutating stage waits until no mutating job is running. A read-only job behind a blocked mutating job still starts, because head-of-line blocking would make one paused prompt stall the whole board. R5.7 asks that mutating stages execute serially, and a single mutation slot delivers exactly that.

- [ ] **Step 1: Write the failing test**

`tests/helpers/fake-run.ts`:

```ts
import type { RunEvent } from '../../src/core/pipeline/events.js'
import { AsyncEventQueue } from '../../src/core/pipeline/queue.js'
import type { RunHandle, RunSummary } from '../../src/core/pipeline/run.js'

export interface FakeRun {
  handle: RunHandle
  events: AsyncEventQueue<RunEvent>
  /** Completes the run successfully. */
  finish(summary?: Partial<RunSummary>): void
  /** Fails the run, which is how R5.8 is exercised. */
  fail(message: string): void
  readonly cancelled: boolean
}

export function fakeRun(runId = 'run-1'): FakeRun {
  const events = new AsyncEventQueue<RunEvent>()
  const base: RunSummary = {
    runId,
    runDir: `/tmp/${runId}`,
    outcome: 'passed',
    skillDigest: 'sha256:0',
    stages: [],
    opened: 0,
    closed: 0,
    reopened: 0,
  }

  let settle!: (summary: RunSummary) => void
  let reject!: (err: Error) => void
  const done = new Promise<RunSummary>((res, rej) => {
    settle = res
    reject = rej
  })
  // The queue attaches its own handler; this one only stops an unhandled
  // rejection warning in the window before it does.
  void done.catch(() => undefined)

  const state = { cancelled: false }

  const handle: RunHandle = {
    runId: Promise.resolve(runId),
    events,
    resolveMutation: () => undefined,
    cancel: async () => {
      state.cancelled = true
      events.close()
      settle({ ...base, outcome: 'errored' })
    },
    done,
  }

  return {
    handle,
    events,
    finish: (summary = {}) => {
      events.close()
      settle({ ...base, ...summary })
    },
    fail: (message) => {
      events.close()
      reject(new Error(message))
    },
    get cancelled() {
      return state.cancelled
    },
  }
}
```

`tests/core/queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../../src/core/config/config.js'
import { createQueue } from '../../src/core/queue/pool.js'
import type { JobSpec, QueueEvent } from '../../src/core/queue/types.js'
import type { SkillRef, Stage } from '../../src/core/types.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
})

const job = (id: string, stages: Stage[] = ['security']): JobSpec => ({ skill: skill(id), stages })

function harness(concurrency: number) {
  const runs = new Map<string, FakeRun>()
  const started: string[] = []
  const events: QueueEvent[] = []
  const queue = createQueue({
    concurrency,
    startRun: (record) => {
      started.push(record.skillId)
      const run = fakeRun(`run-${record.skillId}`)
      runs.set(record.jobId, run)
      return run.handle
    },
  })
  void (async () => {
    for await (const event of queue.events) events.push(event)
  })()
  return { queue, runs, started, events }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe('enqueue', () => {
  it('accepts a batch and returns one id per job — R5.5', async () => {
    const { queue, events } = harness(2)
    const ids = queue.enqueue([job('a'), job('b'), job('c')])
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    await tick()
    expect(events.filter((e) => e.type === 'job:queued')).toHaveLength(3)
    queue.close()
  })

  it('defaults to a limit of two — R5.6', () => {
    expect(DEFAULT_CONFIG.concurrency).toBe(2)
  })
})

describe('bounded worker pool', () => {
  it('never runs more than the configured limit — R5.6', async () => {
    const { queue, runs, started } = harness(2)
    const ids = queue.enqueue([job('a'), job('b'), job('c'), job('d')])
    await tick()
    expect(started).toEqual(['a', 'b'])
    expect(queue.snapshot().queued).toHaveLength(2)

    runs.get(ids[0]!)?.finish()
    await tick()
    expect(started).toEqual(['a', 'b', 'c'])

    for (const id of ids) runs.get(id)?.finish()
    await queue.idle()
    expect(started).toEqual(['a', 'b', 'c', 'd'])
    queue.close()
  })

  it('keeps running other skills when one fails — R5.8', async () => {
    const { queue, runs, events } = harness(2)
    const ids = queue.enqueue([job('a'), job('b'), job('c')])
    await tick()
    runs.get(ids[0]!)?.fail('ledger exploded')
    await tick()
    runs.get(ids[1]!)?.finish()
    runs.get(ids[2]!)?.finish()
    await queue.idle()

    const failed = events.filter((e) => e.type === 'job:failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.type === 'job:failed' && failed[0].job.error).toMatch(/ledger exploded/)
    expect(events.filter((e) => e.type === 'job:done')).toHaveLength(2)
    queue.close()
  })
})

describe('mutating stages', () => {
  it('never runs two at once whatever the limit says — R5.7', async () => {
    const { queue, runs, started } = harness(4)
    const ids = queue.enqueue([
      job('a', ['optimise']),
      job('b', ['optimise']),
      job('c', ['release']),
    ])
    await tick()
    expect(started).toEqual(['a'])
    expect(queue.snapshot().running).toHaveLength(1)

    runs.get(ids[0]!)?.finish()
    await tick()
    expect(started).toEqual(['a', 'b'])

    runs.get(ids[1]!)?.finish()
    await tick()
    runs.get(ids[2]!)?.finish()
    await queue.idle()
    expect(started).toEqual(['a', 'b', 'c'])
    queue.close()
  })

  it('lets a read-only job past a blocked mutating one', async () => {
    const { queue, runs, started } = harness(2)
    const ids = queue.enqueue([job('a', ['optimise']), job('b', ['optimise']), job('c')])
    await tick()
    expect(started).toEqual(['a', 'c'])
    for (const id of ids) runs.get(id)?.finish()
    await queue.idle()
    queue.close()
  })
})

describe('run events and snapshot', () => {
  it('forwards run events tagged with their job id', async () => {
    const { queue, runs, events } = harness(1)
    const [id] = queue.enqueue([job('a')])
    await tick()
    runs.get(id!)?.events.push({
      type: 'stage:start',
      runId: 'run-a',
      stage: 'security',
      toolIds: ['skillspector'],
    })
    await tick()
    const forwarded = events.find((e) => e.type === 'run:event')
    expect(forwarded).toMatchObject({ jobId: id, event: { type: 'stage:start' } })
    runs.get(id!)?.finish()
    await queue.idle()
    queue.close()
  })

  it('reports queued, running and completed with the run id — R5.10', async () => {
    const { queue, runs } = harness(1)
    const ids = queue.enqueue([job('a'), job('b')])
    await tick()
    expect(queue.snapshot()).toMatchObject({
      concurrency: 1,
      queued: [{ skillId: 'b', state: 'queued' }],
      running: [{ skillId: 'a', state: 'running' }],
    })
    runs.get(ids[0]!)?.finish({ outcome: 'failed' })
    await tick()
    expect(queue.snapshot().completed[0]).toMatchObject({
      skillId: 'a',
      state: 'done',
      outcome: 'failed',
      runId: 'run-a',
    })
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    queue.close()
  })

  it('runs one skill twice without interference — R5.3', async () => {
    const { queue, runs, started } = harness(1)
    const ids = queue.enqueue([job('a', ['security']), job('a', ['security'])])
    await tick()
    runs.get(ids[0]!)?.finish()
    await tick()
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    expect(started).toEqual(['a', 'a'])
    expect(queue.snapshot().completed.map((j) => j.state)).toEqual(['done', 'done'])
    queue.close()
  })

  it('enqueues nothing of its own accord — R5.4', async () => {
    const { queue, runs, started } = harness(2)
    const ids = queue.enqueue([job('a', ['optimise'])])
    await tick()
    runs.get(ids[0]!)?.finish()
    await queue.idle()
    await tick()
    expect(started).toEqual(['a'])
    expect(queue.snapshot().queued).toEqual([])
    queue.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the queue types**

`src/core/queue/types.ts`:

```ts
import type { RunEvent } from '../pipeline/events.js'
import type { SkillRef, Stage, StageOutcome } from '../types.js'

export interface JobSpec {
  skill: SkillRef
  stages: readonly Stage[]
  trigger?: string
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface JobRecord {
  jobId: string
  skillId: string
  stages: readonly Stage[]
  state: JobState
  runId: string | null
  outcome: StageOutcome | null
  error: string | null
  enqueuedAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface QueueSnapshot {
  concurrency: number
  queued: JobRecord[]
  running: JobRecord[]
  completed: JobRecord[]
}

export type QueueEvent =
  | { type: 'job:queued'; job: JobRecord }
  | { type: 'job:started'; job: JobRecord }
  | { type: 'job:done'; job: JobRecord }
  | { type: 'job:failed'; job: JobRecord }
  | { type: 'job:cancelled'; job: JobRecord }
  /** Every run event, tagged so one stream can drive one store. */
  | { type: 'run:event'; jobId: string; event: RunEvent }

export interface QueueHandle {
  enqueue(specs: readonly JobSpec[]): string[]
  snapshot(): QueueSnapshot
  cancelJob(jobId: string): Promise<void>
  events: AsyncIterable<QueueEvent>
  /** Resolves when nothing is queued and nothing is running. */
  idle(): Promise<void>
  close(): void
}

/** R5.7's set. Kept here so the queue never imports a stage executor. */
export const MUTATING_STAGES: ReadonlySet<Stage> = new Set<Stage>(['optimise', 'release'])

export const isMutatingJob = (stages: readonly Stage[]): boolean =>
  stages.some((stage) => MUTATING_STAGES.has(stage))
```

- [ ] **Step 4: Write the pool**

`src/core/queue/pool.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { RunHandle } from '../pipeline/run.js'
import { AsyncEventQueue } from '../pipeline/queue.js'
import {
  type JobRecord,
  type JobSpec,
  type QueueEvent,
  type QueueHandle,
  type QueueSnapshot,
  isMutatingJob,
} from './types.js'

export interface QueueOptions {
  concurrency: number
  /** Injected so the queue schedules and the caller wires. */
  startRun: (job: JobRecord, spec: JobSpec) => RunHandle
}

interface Entry {
  job: JobRecord
  spec: JobSpec
}

const nowIso = (): string => new Date().toISOString()

export function createQueue(options: QueueOptions): QueueHandle {
  const concurrency = Math.max(1, options.concurrency)
  const events = new AsyncEventQueue<QueueEvent>()
  const queued: Entry[] = []
  const running = new Map<string, Entry & { handle: RunHandle; settled: Promise<void> }>()
  const completed: JobRecord[] = []
  let idleWaiters: Array<() => void> = []
  let closed = false

  const mutatingRunning = (): boolean =>
    [...running.values()].some((entry) => isMutatingJob(entry.job.stages))

  const settleIdle = (): void => {
    if (queued.length > 0 || running.size > 0) return
    for (const waiter of idleWaiters) waiter()
    idleWaiters = []
  }

  const finish = (job: JobRecord): void => {
    job.endedAt = nowIso()
    running.delete(job.jobId)
    completed.push(job)
    const type =
      job.state === 'cancelled' ? 'job:cancelled' : job.state === 'failed' ? 'job:failed' : 'job:done'
    events.push({ type, job: { ...job } } as QueueEvent)
    pump()
  }

  /**
   * One job's failure is contained here: nothing rethrows, so the pool keeps
   * draining whatever else was enqueued. That is R5.8.
   */
  const drive = async (job: JobRecord, handle: RunHandle): Promise<void> => {
    const forwarding = (async () => {
      for await (const event of handle.events) {
        events.push({ type: 'run:event', jobId: job.jobId, event })
      }
    })()

    try {
      const summary = await handle.done
      job.runId = summary.runId
      job.outcome = summary.outcome
      if (job.state !== 'cancelled') job.state = 'done'
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err)
      if (job.state !== 'cancelled') job.state = 'failed'
    }

    await forwarding.catch(() => undefined)
    finish(job)
  }

  const start = (entry: Entry): void => {
    entry.job.state = 'running'
    entry.job.startedAt = nowIso()
    const handle = options.startRun(entry.job, entry.spec)
    const record = { ...entry, handle, settled: Promise.resolve() }
    record.settled = drive(entry.job, handle)
    running.set(entry.job.jobId, record)
    events.push({ type: 'job:started', job: { ...entry.job } })
  }

  function pump(): void {
    while (!closed && running.size < concurrency) {
      // A mutating job waits for the single mutation slot; anything read-only
      // behind it still starts, so one paused prompt cannot stall the board.
      const index = queued.findIndex(
        (entry) => !isMutatingJob(entry.job.stages) || !mutatingRunning(),
      )
      if (index === -1) break
      const [entry] = queued.splice(index, 1)
      start(entry as Entry)
    }
    settleIdle()
  }

  return {
    enqueue(specs) {
      const ids: string[] = []
      for (const spec of specs) {
        const job: JobRecord = {
          jobId: randomUUID(),
          skillId: spec.skill.id,
          stages: [...spec.stages],
          state: 'queued',
          runId: null,
          outcome: null,
          error: null,
          enqueuedAt: nowIso(),
          startedAt: null,
          endedAt: null,
        }
        queued.push({ job, spec })
        ids.push(job.jobId)
        events.push({ type: 'job:queued', job: { ...job } })
      }
      pump()
      return ids
    },

    snapshot(): QueueSnapshot {
      return {
        concurrency,
        queued: queued.map((entry) => ({ ...entry.job })),
        running: [...running.values()].map((entry) => ({ ...entry.job })),
        completed: completed.map((job) => ({ ...job })),
      }
    },

    async cancelJob(_jobId: string): Promise<void> {
      // Task 4.
    },

    events,

    idle(): Promise<void> {
      if (queued.length === 0 && running.size === 0) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },

    close(): void {
      closed = true
      events.close()
    },
  }
}
```

- [ ] **Step 5: Export the queue from the engine surface**

Add to `src/core/index.ts`:

```ts
export { createQueue, type QueueOptions } from './queue/pool.js'
export {
  MUTATING_STAGES,
  isMutatingJob,
  type JobRecord,
  type JobSpec,
  type JobState,
  type QueueEvent,
  type QueueHandle,
  type QueueSnapshot,
} from './queue/types.js'
export type { CancelPhase, RunPhase } from './pipeline/cancellation.js'
export type {
  PendingMutation,
  StageContext,
  StageResult,
  ToolRunRecord,
} from './stages/types.js'
export { STAGE_ORDER } from './workspace/layout.js'
export { readIndex, type IndexEntry } from './workspace/writer.js'
export { discoverSkills, workspacePath } from './discovery/discover.js'
```

`discoverSkills` is already exported by M1; keep one export, not two.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/queue.test.ts`
Expected: PASS, nine cases.

- [ ] **Step 7: Commit**

```bash
git add src/core/queue src/core/index.ts tests/core/queue.test.ts tests/helpers/fake-run.ts
git commit -m "feat(queue): drain a batch through a bounded pool with a single mutation slot"
```

---

### Task 4: Cancelling a queued or running job

**Files:**
- Modify: `src/core/queue/pool.ts`
- Test: `tests/core/queue-cancel.test.ts`

**Interfaces:**
- Consumes: `createQueue` (Task 3), `fakeRun` (Task 3).
- Produces: a working `QueueHandle.cancelJob(jobId)` that resolves once the job has settled.

R5.10 and the first row of §11.4's table. A queued job is removed before anything spawns, so there is no run directory to clean up; a running job is cancelled through its `RunHandle`, which finalises before `cancelJob` resolves.

- [ ] **Step 1: Write the failing test**

`tests/core/queue-cancel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/queue/pool.js'
import type { JobSpec, QueueEvent } from '../../src/core/queue/types.js'
import type { SkillRef, Stage } from '../../src/core/types.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
})

const job = (id: string, stages: Stage[] = ['security']): JobSpec => ({ skill: skill(id), stages })
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

function harness(concurrency: number) {
  const runs = new Map<string, FakeRun>()
  const started: string[] = []
  const events: QueueEvent[] = []
  const queue = createQueue({
    concurrency,
    startRun: (record) => {
      started.push(record.skillId)
      const run = fakeRun(`run-${record.skillId}`)
      runs.set(record.jobId, run)
      return run.handle
    },
  })
  void (async () => {
    for await (const event of queue.events) events.push(event)
  })()
  return { queue, runs, started, events }
}

describe('cancelJob', () => {
  it('removes a queued job without ever starting it', async () => {
    const { queue, started, events } = harness(1)
    const ids = queue.enqueue([job('a'), job('b')])
    await tick()
    await queue.cancelJob(ids[1]!)

    expect(started).toEqual(['a'])
    expect(queue.snapshot().queued).toEqual([])
    expect(events.filter((e) => e.type === 'job:cancelled')).toHaveLength(1)
    expect(queue.snapshot().completed[0]).toMatchObject({ skillId: 'b', state: 'cancelled' })
    queue.close()
  })

  it('cancels a running job through its run handle and waits for it to settle', async () => {
    const { queue, runs, events } = harness(1)
    const ids = queue.enqueue([job('a')])
    await tick()
    await queue.cancelJob(ids[0]!)

    expect(runs.get(ids[0]!)?.cancelled).toBe(true)
    expect(queue.snapshot().running).toEqual([])
    const cancelled = events.filter((e) => e.type === 'job:cancelled')
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]?.type === 'job:cancelled' && cancelled[0].job.state).toBe('cancelled')
    queue.close()
  })

  it('starts the next job once a running one is cancelled', async () => {
    const { queue, started, runs } = harness(1)
    const ids = queue.enqueue([job('a'), job('b')])
    await tick()
    await queue.cancelJob(ids[0]!)
    await tick()
    expect(started).toEqual(['a', 'b'])
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    queue.close()
  })

  it('is a no-op for an unknown or already completed job', async () => {
    const { queue, runs } = harness(1)
    const ids = queue.enqueue([job('a')])
    await tick()
    runs.get(ids[0]!)?.finish()
    await queue.idle()

    await expect(queue.cancelJob(ids[0]!)).resolves.toBeUndefined()
    await expect(queue.cancelJob('not-a-job')).resolves.toBeUndefined()
    queue.close()
  })

  it('frees the mutation slot when a mutating job is cancelled', async () => {
    const { queue, started, runs } = harness(2)
    const ids = queue.enqueue([job('a', ['optimise']), job('b', ['optimise'])])
    await tick()
    expect(started).toEqual(['a'])
    await queue.cancelJob(ids[0]!)
    await tick()
    expect(started).toEqual(['a', 'b'])
    runs.get(ids[1]!)?.finish()
    await queue.idle()
    queue.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/queue-cancel.test.ts`
Expected: FAIL — `cancelJob` is a no-op stub, so nothing is removed and no event is emitted.

- [ ] **Step 3: Implement cancellation**

In `src/core/queue/pool.ts`, replace the stub with:

```ts
    async cancelJob(jobId: string): Promise<void> {
      const index = queued.findIndex((entry) => entry.job.jobId === jobId)
      if (index !== -1) {
        const [entry] = queued.splice(index, 1)
        const job = (entry as Entry).job
        job.state = 'cancelled'
        // §11.4 row 1: nothing started, so there is no run directory and no
        // evidence to preserve. `finish` emits and re-pumps.
        finish(job)
        return
      }

      const active = running.get(jobId)
      if (!active) return

      // Set the state first so `drive` reports a cancellation rather than a
      // completion when the handle settles.
      active.job.state = 'cancelled'
      await active.handle.cancel('cancelled from the queue')
      await active.settled
    },
```

`finish` already deletes from `running`, appends to `completed`, emits the right event and calls `pump`, so the queued branch reuses it whole.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/queue-cancel.test.ts tests/core/queue.test.ts`
Expected: PASS, five new cases plus Task 3's nine.

- [ ] **Step 5: Commit**

```bash
git add src/core/queue/pool.ts tests/core/queue-cancel.test.ts
git commit -m "feat(queue): cancel queued and running jobs through the handle"
```

---

### Task 5: Cross-process finalisation and a logged lock reclaim

**Files:**
- Create: `tests/helpers/child.ts`
- Modify: `src/core/workspace/writer.ts`, `package.json` (add `tsx`), `.gitignore` (add `tests/tmp/`)
- Test: `tests/core/workspace-concurrency.test.ts`

**Interfaces:**
- Consumes: `claimRunDir`, `finalizeRun`, `readIndex`, `withSkillLock`, `LOCK_STALE_MS` (M1 Task 15).
- Produces: `ReclaimReason`, `ReclaimListener`, `reclaimLogPath(workspacePath)`, `appendReclaimLog(workspacePath, pid, reason)`, and a `withSkillLock` whose default listener writes that log.
- Produces the test helper `runInChild(source)` and the constant `CORE`.

R6.7 and R6.9 are M2's because M1 can only test them in one process, and one process proves neither. Two runs in one process share a lock table, so `withSkillLock` serialises them through its own in-memory sequencing whether or not the lockfile works. Two runs in two processes share only the filesystem, which is the thing the requirement is about.

R6.9 also asks that a reclaim be logged. M1's `onReclaim` defaults to a no-op, so a broken lease leaves no trace. The default becomes an append to `skillgantry/lock-reclaims.log`, which is the only durable channel available to a module forbidden from touching the console.

- [ ] **Step 1: Write the failing test**

`tests/helpers/child.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const TMP_DIR = join(process.cwd(), 'tests', 'tmp')

/** Import prefix for a child module, which lives two levels below the repo root. */
export const CORE = '../../src/core'

/**
 * Runs a module in a second Node process against this repo's sources. The
 * second process is the point: R6.7 and R6.9 are about two processes sharing a
 * directory, and an in-process test shares a lock table instead.
 */
export async function runInChild(source: string): Promise<string> {
  await mkdir(TMP_DIR, { recursive: true })
  const file = join(TMP_DIR, `child-${randomUUID()}.ts`)
  await writeFile(file, source)
  try {
    const { stdout } = await exec('pnpm', ['exec', 'tsx', file], { cwd: process.cwd() })
    return stdout
  } finally {
    await rm(file, { force: true })
  }
}
```

`tests/core/workspace-concurrency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readlink, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOCK_STALE_MS,
  claimRunDir,
  readIndex,
  reclaimLogPath,
  withSkillLock,
} from '../../src/core/workspace/writer.js'
import { CORE, runInChild } from '../helpers/child.js'

const ws = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-conc-'))

const finaliseInChild = (workspace: string, runId: string, endedAt: string): string => `
import { finalizeRun } from '${CORE}/workspace/writer.js'
await finalizeRun(${JSON.stringify(workspace)}, {
  runId: ${JSON.stringify(runId)},
  outcome: 'passed',
  endedAt: ${JSON.stringify(endedAt)},
})
process.stdout.write('ok')
`

const claimInChild = (workspace: string, count: number): string => `
import { claimRunDir } from '${CORE}/workspace/writer.js'
const ids = []
for (let i = 0; i < ${count}; i += 1) ids.push((await claimRunDir(${JSON.stringify(workspace)})).runId)
process.stdout.write(JSON.stringify(ids))
`

describe('two processes finalising one skill — R6.7', () => {
  it('loses no index entry', async () => {
    const root = await ws()
    const a = await claimRunDir(root)
    const b = await claimRunDir(root)

    await Promise.all([
      runInChild(finaliseInChild(root, a.runId, '2026-08-01T00:00:00Z')),
      runInChild(finaliseInChild(root, b.runId, '2026-08-01T00:01:00Z')),
    ])

    const entries = await readIndex(root)
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((e) => e.runId))).toEqual(new Set([a.runId, b.runId]))
  }, 60_000)

  it('agrees on latest when finish order is inverted', async () => {
    const root = await ws()
    const first = await claimRunDir(root)
    const second = await claimRunDir(root)
    expect(second.runId > first.runId).toBe(true)

    // Claimed second, finalised first.
    await runInChild(finaliseInChild(root, second.runId, '2026-08-01T00:00:00Z'))
    await runInChild(finaliseInChild(root, first.runId, '2026-08-01T00:05:00Z'))

    expect(await readlink(join(root, 'skillgantry/runs/latest'))).toContain(second.runId)
  }, 60_000)

  it('never hands two processes the same run directory', async () => {
    const root = await ws()
    const [one, two] = await Promise.all([
      runInChild(claimInChild(root, 20)),
      runInChild(claimInChild(root, 20)),
    ])
    const ids = [...(JSON.parse(one) as string[]), ...(JSON.parse(two) as string[])]
    expect(ids).toHaveLength(40)
    expect(new Set(ids).size).toBe(40)
  }, 60_000)
})

describe('lock reclaim — R6.9', () => {
  it('reclaims and logs a lock whose holder is dead', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    // Above every platform's pid_max default, so the holder cannot exist.
    await writeFile(join(root, 'skillgantry/.lock'), JSON.stringify({ pid: 4194305 }))

    expect(await withSkillLock(root, async () => 'ran', 2_000)).toBe('ran')

    const log = await readFile(reclaimLogPath(root), 'utf8')
    const record = JSON.parse(log.trim().split('\n')[0]!) as Record<string, unknown>
    expect(record).toMatchObject({ pid: 4194305, reason: 'dead-holder', by: process.pid })
  })

  it('reclaims and logs a lease whose heartbeat stopped', async () => {
    const root = await ws()
    await mkdir(join(root, 'skillgantry'), { recursive: true })
    const path = join(root, 'skillgantry/.lock')
    // A live pid with a dead heartbeat: the lease, not the holder, is stale.
    await writeFile(path, JSON.stringify({ pid: process.pid }))
    const old = new Date(Date.now() - LOCK_STALE_MS * 2)
    await utimes(path, old, old)

    expect(await withSkillLock(root, async () => 'ran', 2_000)).toBe('ran')

    const log = await readFile(reclaimLogPath(root), 'utf8')
    expect(JSON.parse(log.trim().split('\n').at(-1)!)).toMatchObject({ reason: 'stale-lease' })
  })

  it('does not break a live, heartbeating lock', async () => {
    const root = await ws()
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const holding = withSkillLock(root, () => held, 30_000)
    await new Promise((r) => setTimeout(r, 20))

    await expect(withSkillLock(root, async () => 'ran', 150)).rejects.toThrow(/timed out/)
    release()
    await holding
    await expect(stat(reclaimLogPath(root))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Add `tsx` and ignore the child directory**

Add to `devDependencies` in `package.json`:

```json
    "tsx": "^4.20.0"
```

Add to `.gitignore`:

```
tests/tmp/
```

Run: `pnpm install`

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/workspace-concurrency.test.ts`
Expected: FAIL — `reclaimLogPath` is not exported and no reclaim log is written.

- [ ] **Step 4: Log the reclaim**

In `src/core/workspace/writer.ts`, add `appendFile` to the `node:fs/promises` import, then add above `withSkillLock`:

```ts
export type ReclaimReason = 'dead-holder' | 'stale-lease'

export type ReclaimListener = (path: string, pid: number, reason: ReclaimReason) => void

export const reclaimLogPath = (workspacePath: string): string =>
  join(workspacePath, 'skillgantry', 'lock-reclaims.log')

/**
 * R6.9 requires a reclaim to be logged, and `core` may not write to the
 * console, so the record goes where the evidence already lives. Fire and
 * forget: failing to log must never fail the run that reclaimed the lock.
 */
export function appendReclaimLog(workspacePath: string, pid: number, reason: ReclaimReason): void {
  const line = JSON.stringify({ at: new Date().toISOString(), pid, reason, by: process.pid })
  void appendFile(reclaimLogPath(workspacePath), `${line}\n`).catch(() => undefined)
}
```

Change `withSkillLock`'s fourth parameter to default to that logger, and pass a reason:

```ts
export async function withSkillLock<T>(
  workspacePath: string,
  fn: () => Promise<T>,
  timeoutMs = 10_000,
  onReclaim: ReclaimListener = (_path, pid, reason) => appendReclaimLog(workspacePath, pid, reason),
): Promise<T> {
```

and inside the retry loop, replace the reclaim branch:

```ts
        const stale = Date.now() - info.mtimeMs > LOCK_STALE_MS
        const dead = typeof held.pid === 'number' && !holderAlive(held.pid)
        if (dead || stale) {
          onReclaim(path, held.pid ?? -1, dead ? 'dead-holder' : 'stale-lease')
          await rm(path, { force: true })
          continue
        }
```

M1's own lock test passes `(_p, pid) => reclaimed.push(pid)`, which still type-checks: a listener may ignore the third argument.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/core/workspace-concurrency.test.ts tests/core/workspace.test.ts`
Expected: PASS, six new cases plus M1's eighteen. The three child-process cases are slow — each spawns `tsx` — which is why they carry an explicit 60-second timeout.

- [ ] **Step 6: Commit**

```bash
git add src/core/workspace/writer.ts package.json pnpm-lock.yaml .gitignore \
        tests/helpers/child.ts tests/core/workspace-concurrency.test.ts
git commit -m "feat(workspace): log lock reclaims and prove finalisation across processes"
```

---

### Task 6: Stream tool output while the tool runs

**Files:**
- Modify: `src/core/runner/spawn.ts`, `src/core/stages/adapter-stage.ts`
- Test: `tests/core/streaming.test.ts`

**Interfaces:**
- Consumes: `runTool`, `RunToolInput` (M1 Task 9), `AdapterStageExecutor` (M1 Task 14).
- Produces: `RunToolInput.onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void`, and an executor that calls `ctx.onOutput` per chunk instead of twice at the end.

M1 hands the whole capture to `ctx.onOutput` after the process exits. R11.4 asks for live output and R11.5 asks that the on-disk log outlive what memory kept, and neither means anything if the frontend learns everything at once at the end.

Chunks are taken from the **redactor's** output, not from the raw stream, so a secret cannot reach the event stream even though `run.stdout` is redacted separately at the end. The headless CLI ignores `tool:output` unless `--json` is set, and with `--json` it now emits more lines of the same shape, which is a stream it already documents as newline-delimited events.

- [ ] **Step 1: Write the failing test**

`tests/core/streaming.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTool } from '../../src/core/runner/spawn.js'
import { makeFakeTool } from '../helpers/fake-tool.js'

const toolDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-stream-'))

const base = {
  cwd: process.cwd(),
  env: {} as NodeJS.ProcessEnv,
  secrets: [] as string[],
  artefacts: [] as string[],
  artefactSizeCapBytes: 1024 * 1024,
  timeoutMs: 10_000,
}

describe('streaming output', () => {
  it('delivers chunks before the process exits', async () => {
    const bin = await makeFakeTool('drip', 'echo one; sleep 0.2; echo two; sleep 0.2; echo three')
    const seen: Array<{ at: number; chunk: string }> = []
    const startedAt = Date.now()

    const out = await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: await toolDir(),
      onChunk: (_stream, chunk) => seen.push({ at: Date.now() - startedAt, chunk }),
    })

    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]!.at).toBeLessThan(out.durationMs)
    expect(seen.map((s) => s.chunk).join('')).toContain('three')
  })

  it('tags the stream each chunk came from', async () => {
    const bin = await makeFakeTool('both', 'echo to-out; echo to-err >&2')
    const streams = new Set<string>()
    await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: await toolDir(),
      onChunk: (stream) => streams.add(stream),
    })
    expect([...streams].sort()).toEqual(['stderr', 'stdout'])
  })

  it('redacts chunks before they leave the runner — R7.4', async () => {
    const secret = 'sk-testtokenvalue000000000000000000'
    const bin = await makeFakeTool('leaky', 'printf "TOKEN=%s\\n" "$ANTHROPIC_AUTH_TOKEN"')
    const chunks: string[] = []
    const dir = await toolDir()

    await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      env: { ANTHROPIC_AUTH_TOKEN: secret },
      secrets: [secret],
      onChunk: (_stream, chunk) => chunks.push(chunk),
    })

    expect(chunks.join('')).not.toContain(secret)
    expect(chunks.join('')).toContain('«redacted')
    expect(await readFile(join(dir, 'stdout.log'), 'utf8')).not.toContain(secret)
  })

  it('keeps the full log on disk when the caller keeps nothing — R11.5', async () => {
    const bin = await makeFakeTool('many', 'i=0; while [ $i -lt 500 ]; do echo "line $i"; i=$((i+1)); done')
    const dir = await toolDir()
    let dropped = 0
    await runTool({
      ...base,
      bin,
      argv: [],
      toolDir: dir,
      onChunk: () => {
        dropped += 1
      },
    })
    const body = await readFile(join(dir, 'stdout.log'), 'utf8')
    expect(body.trim().split('\n')).toHaveLength(500)
    expect(dropped).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/core/streaming.test.ts`
Expected: FAIL — `onChunk` is not a known property of `RunToolInput`.

- [ ] **Step 3: Emit chunks from the runner**

In `src/core/runner/spawn.ts`, add the field to `RunToolInput`:

```ts
  /** Called with redacted text as it arrives, for a live frontend. */
  onChunk?: (stream: 'stdout' | 'stderr', chunk: string) => void
```

and replace the stream wiring loop inside `runTool`:

```ts
  for (const stream of ['stdout', 'stderr'] as const) {
    const source = child[stream]
    if (!source) continue
    const redactor = new RedactionTransform(input.secrets)
    const sink = createWriteStream(join(input.toolDir, `${stream}.log`))
    source.setEncoding('utf8')
    source.on('data', (chunk: string) => {
      capture[stream] += chunk
    })
    // Chunks are taken downstream of the redactor, so a secret cannot reach a
    // frontend even though the final capture is redacted separately.
    redactor.setEncoding('utf8')
    if (input.onChunk) {
      const emit = input.onChunk
      redactor.on('data', (chunk: string) => emit(stream, chunk))
    }
    source.pipe(redactor).pipe(sink)
    closed.push(new Promise<void>((resolve) => sink.on('close', () => resolve())))
  }
```

- [ ] **Step 4: Forward chunks from the executor**

In `src/core/stages/adapter-stage.ts`, add `onChunk` to the `runTool` call:

```ts
        onChunk: (stream, chunk) => ctx.onOutput(toolId, stream, chunk),
```

and delete the two post-run calls that replayed the whole capture:

```ts
      ctx.onOutput(toolId, 'stdout', run.stdout)
      ctx.onOutput(toolId, 'stderr', run.stderr)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/core/streaming.test.ts tests/core/spawn.test.ts tests/core/adapter-stage.test.ts`
Expected: PASS, four new cases plus M1's eight and fifteen.

- [ ] **Step 6: Commit**

```bash
git add src/core/runner/spawn.ts src/core/stages/adapter-stage.ts tests/core/streaming.test.ts
git commit -m "feat(runner): emit redacted output chunks while a tool runs"
```

---

### Task 7: TUI toolchain and the boundary rule that comes with it

**Files:**
- Create: `src/tui/index.tsx`, `tests/helpers/render-ink.tsx`
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- Test: `tests/tui/toolchain.test.tsx`, `tests/boundary.test.ts` (one added case)

**Interfaces:**
- Consumes: the M1 scaffold (Task 1 of plan-m1).
- Produces: `renderApp(props)` in `src/tui/index.tsx`; the test helper `renderInk(node)` returning `{ lastFrame, frames, stdin, unmount, waitForFrame }`.

Two decisions:

**No `ink-testing-library`.** Design §16 names it, but it tracks Ink's major versions and adds a second thing to keep in step with React. The helper below is twenty lines against Ink's own `render`, which is what that library wraps. Recorded here as a deliberate deviation from §16 rather than an oversight.

**`src/tui/**` may import core only through `src/core/index.ts`.** M1's lint rules stop `core` importing outwards. The new consumer needs the mirror rule, or the TUI grows a dependency on `ledger/db.js` and design §2's single public surface stops being true.

- [ ] **Step 1: Write the failing test**

`tests/helpers/render-ink.tsx`:

```tsx
import { EventEmitter } from 'node:events'
import type { ReactElement } from 'react'
import { render } from 'ink'

class FakeStdout extends EventEmitter {
  readonly columns = 100
  readonly rows = 30
  readonly frames: string[] = []
  write(data: string): boolean {
    this.frames.push(data)
    return true
  }
}

class FakeStdin extends EventEmitter {
  readonly isTTY = true
  setRawMode(): this {
    return this
  }
  setEncoding(): this {
    return this
  }
  resume(): this {
    return this
  }
  pause(): this {
    return this
  }
  ref(): void {}
  unref(): void {}
  read(): null {
    return null
  }
  /** Delivers a keypress the way a terminal would. */
  send(data: string): void {
    this.emit('data', data)
  }
}

export interface InkHarness {
  frames: string[]
  lastFrame(): string
  stdin: FakeStdin
  unmount(): void
  /** Lets effects, timers and one render cycle settle. */
  settle(ms?: number): Promise<void>
}

/**
 * `debug: true` makes Ink write a complete frame per render instead of ANSI
 * deltas, so a frame is directly assertable.
 */
export function renderInk(node: ReactElement): InkHarness {
  const stdout = new FakeStdout()
  const stdin = new FakeStdin()
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  return {
    frames: stdout.frames,
    lastFrame: () => stdout.frames.at(-1) ?? '',
    stdin,
    unmount: () => instance.unmount(),
    settle: (ms = 20) => new Promise<void>((r) => setTimeout(r, ms)),
  }
}
```

`tests/tui/toolchain.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import { renderInk } from '../helpers/render-ink.js'

function Probe(): React.ReactElement {
  const [pressed, setPressed] = useState('none')
  useInput((input) => setPressed(input))
  return (
    <Box flexDirection="column">
      <Text>skillgantry</Text>
      <Text>pressed: {pressed}</Text>
    </Box>
  )
}

describe('ink toolchain', () => {
  it('renders a component to a frame', async () => {
    const ui = renderInk(<Probe />)
    await ui.settle()
    expect(ui.lastFrame()).toContain('skillgantry')
    ui.unmount()
  })

  it('delivers keypresses through the fake stdin', async () => {
    const ui = renderInk(<Probe />)
    await ui.settle()
    ui.stdin.send('q')
    await ui.settle()
    expect(ui.lastFrame()).toContain('pressed: q')
    ui.unmount()
  })
})
```

Add one case to `tests/boundary.test.ts`:

```ts
  it('rejects a deep core import from tui', async () => {
    const offender = join(process.cwd(), 'src/tui/__boundary_probe__.ts')
    await writeFile(offender, `import '../core/ledger/db.js'\nexport const x = 1\n`)
    try {
      await run('pnpm', ['exec', 'eslint', offender], { cwd: process.cwd() })
      throw new Error('eslint should have failed')
    } catch (err) {
      expect(String((err as { stdout?: string }).stdout)).toContain('no-restricted-imports')
    } finally {
      await rm(offender, { force: true })
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/tui/toolchain.test.tsx tests/boundary.test.ts`
Expected: FAIL — `ink` is not installed, `.tsx` is not in the vitest include list, and the deep-import probe passes lint.

- [ ] **Step 3: Install and configure**

Add to `dependencies` in `package.json`:

```json
    "ink": "^6.0.0",
    "react": "^19.0.0"
```

and to `devDependencies`:

```json
    "@types/react": "^19.0.0"
```

Add `"jsx": "react-jsx"` to `compilerOptions` in `tsconfig.json`.

Add `.tsx` to the vitest include list in `vitest.config.ts`:

```ts
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
```

In `eslint.config.js`, extend the `src/tui/**` block so it also forbids deep core imports:

```js
  {
    files: ['src/tui/**/*.ts', 'src/tui/**/*.tsx'],
    rules: noCrossImport([
      { group: ['**/cli/**'], message: 'tui must not import cli' },
      {
        group: ['**/core/*/**'],
        message: 'tui imports core only through src/core/index.ts',
      },
    ]),
  },
```

Run: `pnpm install`

Verify the resolved versions, since Ink 6 requires React 19 and a mismatch surfaces as a runtime hook error rather than a type error:

```bash
pnpm why react
```

Expected: one `react` version, `19.x`, with `ink` depending on it.

- [ ] **Step 4: Write the entry point**

`src/tui/index.tsx`:

```tsx
import { render } from 'ink'
import { App, type AppProps } from './app.js'

/** Resolves when the user quits. The caller owns the queue and the ledger. */
export async function renderApp(props: AppProps): Promise<void> {
  const instance = render(<App {...props} />)
  await instance.waitUntilExit()
}

export type { AppProps } from './app.js'
```

This file does not compile until Task 10 creates `app.tsx`. Create a placeholder `src/tui/app.tsx` now so the build is green, and Task 10 replaces it whole:

```tsx
import { Text } from 'ink'
import type { Stage } from '../core/index.js'
import type { QueueHandle } from '../core/index.js'
import type { SkillRef } from '../core/index.js'

export interface AppProps {
  skills: readonly SkillRef[]
  queue: QueueHandle
  stages: readonly Stage[]
  concurrency: number
  intervalMs?: number
}

/** Placeholder. Task 10 replaces this with the Work screen. */
export function App(_props: AppProps): React.ReactElement {
  return <Text>SkillGantry</Text>
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tui/toolchain.test.tsx tests/boundary.test.ts && pnpm lint && pnpm build`
Expected: PASS, two new cases plus M1's two boundary cases and the new third; lint and build clean.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts eslint.config.js \
        src/tui tests/helpers/render-ink.tsx tests/tui/toolchain.test.tsx tests/boundary.test.ts
git commit -m "feat(tui): add the ink toolchain and enforce the core surface boundary"
```

---

### Task 8: Ring buffer and the fixed-interval log pump

**Files:**
- Create: `src/tui/log-buffer.ts`
- Test: `tests/tui/log-buffer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class RingBuffer` with `push`, `snapshot`, `size`, `dropped`, `capacity`; `class LogPump` with `write(source, chunk)`, `start()`, `stop()`, `flush()`, and the options `{ capacity, intervalMs, onFlush }`; the constants `LOG_CAPACITY` and `FLUSH_INTERVAL_MS`.

This is R11.4's mechanism. Two properties matter and both are tested: memory is bounded whatever the tool emits, and the number of state updates is bounded by elapsed time rather than by line count.

**One buffer per run, per-source line assembly.** Design §14 says "per-tool-run ring buffer". The pane renders one interleaved log, so a buffer per tool would have to be re-merged on every flush and would lose interleaving order. The pump instead keeps a **carry string per source** — a chunk can end mid-line, and two tools writing concurrently must not splice their halves together — and pushes assembled lines into one buffer. Same guarantee, one merge fewer.

- [ ] **Step 1: Write the failing test**

`tests/tui/log-buffer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogPump, RingBuffer } from '../../src/tui/log-buffer.js'

describe('RingBuffer', () => {
  it('keeps the newest lines in order', () => {
    const ring = new RingBuffer(3)
    for (const line of ['a', 'b', 'c', 'd']) ring.push(line)
    expect(ring.snapshot()).toEqual(['b', 'c', 'd'])
    expect(ring.size).toBe(3)
    expect(ring.dropped).toBe(1)
  })

  it('is bounded under sustained volume', () => {
    const ring = new RingBuffer(2000)
    for (let i = 0; i < 10_000; i += 1) ring.push(`line ${i}`)
    expect(ring.size).toBe(2000)
    expect(ring.dropped).toBe(8000)
    expect(ring.snapshot().at(-1)).toBe('line 9999')
    expect(ring.snapshot()[0]).toBe('line 8000')
  })

  it('returns the tail when asked for fewer lines than it holds', () => {
    const ring = new RingBuffer(10)
    for (let i = 0; i < 10; i += 1) ring.push(`l${i}`)
    expect(ring.snapshot(2)).toEqual(['l8', 'l9'])
  })
})

describe('LogPump', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes on the tick, not on the write — R11.4', () => {
    const flushes: number[] = []
    const pump = new LogPump({ capacity: 100, intervalMs: 100, onFlush: (lines) => flushes.push(lines.length) })
    pump.start()

    for (let i = 0; i < 500; i += 1) pump.write('skillspector', `line ${i}\n`)
    expect(flushes).toEqual([])

    vi.advanceTimersByTime(100)
    expect(flushes).toEqual([100])
    pump.stop()
  })

  it('bounds state updates by elapsed time, not by line count', () => {
    let flushes = 0
    const pump = new LogPump({ capacity: 2000, intervalMs: 100, onFlush: () => (flushes += 1) })
    pump.start()

    // 10,000 lines spread over five seconds: 50 ticks, so at most 51 flushes.
    for (let step = 0; step < 50; step += 1) {
      for (let i = 0; i < 200; i += 1) pump.write('skillspector', `line ${step}-${i}\n`)
      vi.advanceTimersByTime(100)
    }
    expect(flushes).toBeLessThanOrEqual(51)
    pump.stop()
  })

  it('does not flush when nothing arrived', () => {
    let flushes = 0
    const pump = new LogPump({ capacity: 10, intervalMs: 100, onFlush: () => (flushes += 1) })
    pump.start()
    vi.advanceTimersByTime(500)
    expect(flushes).toBe(0)
    pump.stop()
  })

  it('assembles a line split across chunks', () => {
    const seen: string[][] = []
    const pump = new LogPump({ capacity: 10, intervalMs: 100, onFlush: (lines) => seen.push([...lines]) })
    pump.start()
    pump.write('t', 'hello ')
    pump.write('t', 'world\n')
    vi.advanceTimersByTime(100)
    expect(seen.at(-1)).toEqual(['t │ hello world'])
    pump.stop()
  })

  it('does not splice two sources together', () => {
    const seen: string[][] = []
    const pump = new LogPump({ capacity: 10, intervalMs: 100, onFlush: (lines) => seen.push([...lines]) })
    pump.start()
    pump.write('a', 'first half ')
    pump.write('b', 'other tool\n')
    pump.write('a', 'second half\n')
    vi.advanceTimersByTime(100)
    expect(seen.at(-1)).toEqual(['b │ other tool', 'a │ first half second half'])
    pump.stop()
  })

  it('reports how many lines it dropped so the pane can point at the file', () => {
    let dropped = -1
    const pump = new LogPump({ capacity: 5, intervalMs: 100, onFlush: (_l, d) => (dropped = d) })
    pump.start()
    for (let i = 0; i < 20; i += 1) pump.write('t', `line ${i}\n`)
    vi.advanceTimersByTime(100)
    expect(dropped).toBe(15)
    pump.stop()
  })

  it('flushes what it holds when stopped', () => {
    const seen: string[][] = []
    const pump = new LogPump({ capacity: 10, intervalMs: 100, onFlush: (lines) => seen.push([...lines]) })
    pump.start()
    pump.write('t', 'last\n')
    pump.stop()
    expect(seen.at(-1)).toEqual(['t │ last'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/log-buffer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the buffer and the pump**

`src/tui/log-buffer.ts`:

```ts
/** Design §14. Both are the acceptance numbers for R11.4. */
export const LOG_CAPACITY = 2000
export const FLUSH_INTERVAL_MS = 100

/**
 * Fixed-size, allocation-free once full. A shifting array would move every
 * element on every line, which is exactly the cost the buffer exists to avoid.
 */
export class RingBuffer {
  readonly #items: string[]
  #start = 0
  #count = 0
  #dropped = 0

  constructor(readonly capacity: number) {
    this.#items = new Array<string>(capacity)
  }

  get size(): number {
    return this.#count
  }

  /** Lines discarded since the buffer was created. The full log is on disk. */
  get dropped(): number {
    return this.#dropped
  }

  push(line: string): void {
    this.#items[(this.#start + this.#count) % this.capacity] = line
    if (this.#count < this.capacity) {
      this.#count += 1
    } else {
      this.#start = (this.#start + 1) % this.capacity
      this.#dropped += 1
    }
  }

  /** The newest `limit` lines, oldest first. */
  snapshot(limit = this.#count): string[] {
    const take = Math.min(limit, this.#count)
    const out: string[] = new Array<string>(take)
    const from = this.#count - take
    for (let i = 0; i < take; i += 1) {
      out[i] = this.#items[(this.#start + from + i) % this.capacity] as string
    }
    return out
  }
}

export interface LogPumpOptions {
  capacity?: number
  intervalMs?: number
  onFlush: (lines: readonly string[], dropped: number) => void
}

/**
 * Sits between the event stream and React. Chunks land in a ring buffer held
 * outside the component tree; a fixed tick copies the window into state, and
 * only when something arrived. This is the whole of R11.4.
 */
export class LogPump {
  readonly #buffer: RingBuffer
  readonly #intervalMs: number
  readonly #onFlush: LogPumpOptions['onFlush']
  /** Per source, because a chunk can end mid-line and two tools interleave. */
  readonly #carry = new Map<string, string>()
  #timer: NodeJS.Timeout | null = null
  #dirty = false

  constructor(options: LogPumpOptions) {
    this.#buffer = new RingBuffer(options.capacity ?? LOG_CAPACITY)
    this.#intervalMs = options.intervalMs ?? FLUSH_INTERVAL_MS
    this.#onFlush = options.onFlush
  }

  write(source: string, chunk: string): void {
    const pending = `${this.#carry.get(source) ?? ''}${chunk}`
    const parts = pending.split('\n')
    this.#carry.set(source, parts.pop() ?? '')
    for (const line of parts) {
      this.#buffer.push(`${source} │ ${line}`)
      this.#dirty = true
    }
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => this.flush(), this.#intervalMs)
    this.#timer.unref?.()
  }

  flush(): void {
    if (!this.#dirty) return
    this.#dirty = false
    this.#onFlush(this.#buffer.snapshot(), this.#buffer.dropped)
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    // A trailing partial line is real output; the tool simply never ended it.
    for (const [source, rest] of this.#carry) {
      if (rest.length > 0) {
        this.#buffer.push(`${source} │ ${rest}`)
        this.#dirty = true
      }
    }
    this.#carry.clear()
    this.flush()
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/log-buffer.test.ts`
Expected: PASS, eleven cases.

- [ ] **Step 5: Commit**

```bash
git add src/tui/log-buffer.ts tests/tui/log-buffer.test.ts
git commit -m "feat(tui): bound live log output in a ring buffer outside react"
```

---

### Task 9: The store the screen is a function of

**Files:**
- Create: `src/tui/store.ts`
- Test: `tests/tui/store.test.ts`

**Interfaces:**
- Consumes: `QueueEvent`, `JobRecord`, `RunEvent`, `SkillRef`, `Stage`, `StageOutcome`, `RawFinding`, `STAGE_ORDER` (all through `src/core/index.js`).
- Produces: `PANELS`, `Panel`, `FOCUSES`, `Focus`, `StageCell`, `SkillRow`, `AppState`, `Action`, `initialState(skills, concurrency)`, `reducer(state, action)`, `selectedSkill(state)`.

One store fed by core events, components as pure functions of it (design §14). Two rules the tests pin down:

**`tool:output` never reaches the reducer.** It goes to the pump. Dispatching one leaves the state identical, which is how R11.4 is asserted rather than asserted about.

**Run events carry no skill id after `run:start`.** The store keeps `runIndex: runId -> skillId` so a later `stage:done` finds its row without the caller threading context through.

- [ ] **Step 1: Write the failing test**

`tests/tui/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { QueueEvent, RunEvent, SkillRef, StageResult, ToolRunRecord } from '../../src/core/index.js'
import { initialState, reducer, selectedSkill } from '../../src/tui/store.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]
const start = (): ReturnType<typeof initialState> => initialState(SKILLS, 2)

const run = (event: RunEvent): QueueEvent => ({ type: 'run:event', jobId: 'j1', event })

const toolRun: ToolRunRecord = {
  toolId: 'skillspector',
  toolVersion: '2.3.7',
  outcome: 'failed',
  exitCode: 0,
  durationMs: 10,
  errorKind: null,
  artefactDir: '/x',
  findings: [
    {
      ruleClass: 'prompt-injection',
      nativeRuleId: 'PI1',
      severity: 'high',
      path: 'declawed/SKILL.md',
      message: 'suspicious instruction',
    },
  ],
  metrics: { findingsTotal: 1 },
  summary: '1 finding',
}

const stageResult: StageResult = {
  stage: 'security',
  outcome: 'failed',
  verdict: 'failed',
  toolRuns: [toolRun],
}

const feed = (events: QueueEvent[]): ReturnType<typeof initialState> =>
  events.reduce((state, event) => reducer(state, { type: 'queue-event', event }), start())

describe('run events', () => {
  it('marks the skill running and clears the previous run', () => {
    const state = feed([
      run({ type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['security'], runDir: '/w/r1' }),
    ])
    expect(state.skills[0]).toMatchObject({ status: 'running', activeRunId: 'r1', runDir: '/w/r1' })
    expect(state.skills[1]?.status).toBe('idle')
  })

  it('fills the lifecycle rail as stages report', () => {
    const state = feed([
      run({ type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['security'], runDir: '/w/r1' }),
      run({ type: 'stage:start', runId: 'r1', stage: 'security', toolIds: ['skillspector'] }),
      run({ type: 'tool:done', runId: 'r1', stage: 'security', toolId: 'skillspector', result: toolRun }),
      run({ type: 'stage:done', runId: 'r1', stage: 'security', outcome: 'failed', result: stageResult }),
    ])
    expect(state.skills[0]?.stages.security).toMatchObject({
      outcome: 'failed',
      running: false,
      summary: '1 finding',
    })
    expect(state.skills[0]?.findings).toHaveLength(1)
  })

  it('settles the status when the run ends', () => {
    const state = feed([
      run({ type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['security'], runDir: '/w/r1' }),
      run({ type: 'run:done', runId: 'r1', outcome: 'failed', opened: 1, closed: 0, reopened: 0 }),
    ])
    expect(state.skills[0]).toMatchObject({ status: 'failed', activeRunId: null })
  })

  it('shows a cancelled run as errored', () => {
    const state = feed([
      run({ type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['security'], runDir: '/w/r1' }),
      run({ type: 'run:cancelled', runId: 'r1', phase: 'running', reason: 'user' }),
    ])
    expect(state.skills[0]).toMatchObject({ status: 'errored', activeRunId: null })
  })

  it('ignores an event for a run it never saw start', () => {
    const before = start()
    const after = reducer(before, {
      type: 'queue-event',
      event: run({ type: 'stage:done', runId: 'ghost', stage: 'security', outcome: 'passed', result: stageResult }),
    })
    expect(after).toBe(before)
  })

  it('never takes log text into state — R11.4', () => {
    const before = feed([
      run({ type: 'run:start', runId: 'r1', skillId: 'declawed', stages: ['security'], runDir: '/w/r1' }),
    ])
    const after = reducer(before, {
      type: 'queue-event',
      event: run({
        type: 'tool:output',
        runId: 'r1',
        stage: 'security',
        toolId: 'skillspector',
        stream: 'stdout',
        chunk: 'scanning…\n',
      }),
    })
    expect(after).toBe(before)
  })
})

describe('job events', () => {
  it('tracks a job through its states without duplicating it', () => {
    const job = {
      jobId: 'j1',
      skillId: 'declawed',
      stages: ['security'] as const,
      state: 'queued' as const,
      runId: null,
      outcome: null,
      error: null,
      enqueuedAt: 'now',
      startedAt: null,
      endedAt: null,
    }
    const state = feed([
      { type: 'job:queued', job },
      { type: 'job:started', job: { ...job, state: 'running' } },
      { type: 'job:done', job: { ...job, state: 'done', outcome: 'passed', runId: 'r1' } },
    ])
    expect(state.jobs).toHaveLength(1)
    expect(state.jobs[0]).toMatchObject({ state: 'done', outcome: 'passed' })
  })
})

describe('navigation', () => {
  it('moves the skill cursor without running off either end', () => {
    let state = reducer(start(), { type: 'select-skill', delta: 1 })
    expect(state.selectedSkill).toBe(1)
    state = reducer(state, { type: 'select-skill', delta: 5 })
    expect(state.selectedSkill).toBe(1)
    state = reducer(state, { type: 'select-skill', delta: -9 })
    expect(state.selectedSkill).toBe(0)
    expect(selectedSkill(state)?.skillId).toBe('declawed')
  })

  it('cycles the output panel', () => {
    let state = reducer(start(), { type: 'cycle-panel', delta: 1 })
    expect(state.panel).toBe('findings')
    state = reducer(state, { type: 'cycle-panel', delta: -1 })
    expect(state.panel).toBe('log')
    state = reducer(state, { type: 'set-panel', panel: 'skill' })
    expect(state.panel).toBe('skill')
  })

  it('marks skills and stages for a batch — R5.5', () => {
    let state = reducer(start(), { type: 'toggle-skill-mark' })
    state = reducer(state, { type: 'select-skill', delta: 1 })
    state = reducer(state, { type: 'toggle-skill-mark' })
    expect(state.markedSkills).toEqual(['declawed', 'spec-lint'])

    state = reducer(state, { type: 'select-stage', delta: 2 })
    state = reducer(state, { type: 'toggle-stage-mark' })
    expect(state.markedStages).toEqual(['security'])

    state = reducer(state, { type: 'toggle-skill-mark' })
    expect(state.markedSkills).toEqual(['declawed'])
  })

  it('stores a flushed log window without inspecting it', () => {
    const state = reducer(start(), { type: 'log-flush', lines: ['a', 'b'], dropped: 7 })
    expect(state.log).toEqual({ lines: ['a', 'b'], dropped: 7 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

`src/tui/store.ts`:

```ts
import {
  STAGE_ORDER,
  type JobRecord,
  type QueueEvent,
  type RawFinding,
  type RunEvent,
  type SkillRef,
  type Stage,
  type StageOutcome,
} from '../core/index.js'

export const PANELS = ['log', 'findings', 'artefacts', 'skill'] as const
export type Panel = (typeof PANELS)[number]

export const FOCUSES = ['skills', 'stages', 'queue'] as const
export type Focus = (typeof FOCUSES)[number]

export type SkillStatus = 'idle' | 'running' | 'passed' | 'failed' | 'errored'

export interface StageCell {
  outcome: StageOutcome | null
  running: boolean
  summary: string
}

export interface SkillRow {
  skillId: string
  label: string
  dir: string
  workspacePath: string
  status: SkillStatus
  activeRunId: string | null
  runDir: string | null
  stages: Record<Stage, StageCell>
  findings: RawFinding[]
}

export interface AppState {
  skills: SkillRow[]
  selectedSkill: number
  selectedStage: number
  selectedJob: number
  markedSkills: string[]
  markedStages: Stage[]
  jobs: JobRecord[]
  focus: Focus
  panel: Panel
  concurrency: number
  /** runId -> skillId. Only run:start names its skill. */
  runIndex: Record<string, string>
  log: { lines: readonly string[]; dropped: number }
  skillMd: string
  artefacts: string[]
}

export type Action =
  | { type: 'queue-event'; event: QueueEvent }
  | { type: 'log-flush'; lines: readonly string[]; dropped: number }
  | { type: 'select-skill'; delta: number }
  | { type: 'select-stage'; delta: number }
  | { type: 'select-job'; delta: number }
  | { type: 'toggle-skill-mark' }
  | { type: 'toggle-stage-mark' }
  | { type: 'clear-marks' }
  | { type: 'set-focus'; focus: Focus }
  | { type: 'cycle-focus'; delta: number }
  | { type: 'set-panel'; panel: Panel }
  | { type: 'cycle-panel'; delta: number }
  | { type: 'set-skill-md'; body: string }
  | { type: 'set-artefacts'; paths: string[] }

const emptyStages = (): Record<Stage, StageCell> =>
  Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, { outcome: null, running: false, summary: '' }]),
  ) as Record<Stage, StageCell>

const toRow = (skill: SkillRef): SkillRow => ({
  skillId: skill.id,
  label: skill.name ?? skill.id,
  dir: skill.dir,
  workspacePath: skill.workspacePath,
  status: 'idle',
  activeRunId: null,
  runDir: null,
  stages: emptyStages(),
  findings: [],
})

export function initialState(skills: readonly SkillRef[], concurrency: number): AppState {
  return {
    skills: skills.map(toRow),
    selectedSkill: 0,
    selectedStage: 0,
    selectedJob: 0,
    markedSkills: [],
    markedStages: [],
    jobs: [],
    focus: 'skills',
    panel: 'log',
    concurrency,
    runIndex: {},
    log: { lines: [], dropped: 0 },
    skillMd: '',
    artefacts: [],
  }
}

export const selectedSkill = (state: AppState): SkillRow | undefined =>
  state.skills[state.selectedSkill]

const clamp = (value: number, length: number): number =>
  length === 0 ? 0 : Math.min(Math.max(value, 0), length - 1)

const cycle = (values: readonly string[], current: string, delta: number): number =>
  (values.indexOf(current) + delta + values.length) % values.length

const toggle = <T>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

const statusOf = (outcome: StageOutcome): SkillStatus =>
  outcome === 'passed' ? 'passed' : outcome === 'failed' ? 'failed' : 'errored'

function withSkill(
  state: AppState,
  skillId: string,
  update: (row: SkillRow) => SkillRow,
): AppState {
  const index = state.skills.findIndex((row) => row.skillId === skillId)
  if (index === -1) return state
  const skills = [...state.skills]
  skills[index] = update(skills[index] as SkillRow)
  return { ...state, skills }
}

const withStage = (row: SkillRow, stage: Stage, patch: Partial<StageCell>): SkillRow => ({
  ...row,
  stages: { ...row.stages, [stage]: { ...row.stages[stage], ...patch } },
})

function onRunEvent(state: AppState, event: RunEvent): AppState {
  if (event.type === 'run:start') {
    const next = withSkill(state, event.skillId, (row) => ({
      ...row,
      status: 'running',
      activeRunId: event.runId,
      runDir: event.runDir,
      stages: emptyStages(),
      findings: [],
    }))
    return { ...next, runIndex: { ...next.runIndex, [event.runId]: event.skillId } }
  }

  // tool:output is deliberately absent: it belongs to the pump, and taking it
  // here would put log text into React state line by line. That is R11.4.
  const skillId = state.runIndex[event.runId]
  if (!skillId) return state

  switch (event.type) {
    case 'stage:start':
      return withSkill(state, skillId, (row) =>
        withStage(row, event.stage, { running: true, summary: event.toolIds.join(', ') }),
      )
    case 'tool:done':
      return withSkill(state, skillId, (row) =>
        withStage({ ...row, findings: [...row.findings, ...event.result.findings] }, event.stage, {
          summary: event.result.summary,
        }),
      )
    case 'stage:done':
      return withSkill(state, skillId, (row) =>
        withStage(row, event.stage, { running: false, outcome: event.outcome }),
      )
    case 'run:done':
      return withSkill(state, skillId, (row) => ({
        ...row,
        status: statusOf(event.outcome),
        activeRunId: null,
      }))
    case 'run:cancelled':
    case 'run:error':
      return withSkill(state, skillId, (row) => ({
        ...row,
        status: 'errored',
        activeRunId: null,
      }))
    default:
      return state
  }
}

function onQueueEvent(state: AppState, event: QueueEvent): AppState {
  if (event.type === 'run:event') return onRunEvent(state, event.event)
  const index = state.jobs.findIndex((job) => job.jobId === event.job.jobId)
  const jobs = index === -1 ? [...state.jobs, event.job] : [...state.jobs]
  if (index !== -1) jobs[index] = event.job
  return { ...state, jobs, selectedJob: clamp(state.selectedJob, jobs.length) }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'queue-event':
      return onQueueEvent(state, action.event)
    case 'log-flush':
      return { ...state, log: { lines: action.lines, dropped: action.dropped } }
    case 'select-skill':
      return { ...state, selectedSkill: clamp(state.selectedSkill + action.delta, state.skills.length) }
    case 'select-stage':
      return { ...state, selectedStage: clamp(state.selectedStage + action.delta, STAGE_ORDER.length) }
    case 'select-job':
      return { ...state, selectedJob: clamp(state.selectedJob + action.delta, state.jobs.length) }
    case 'toggle-skill-mark': {
      const row = selectedSkill(state)
      return row ? { ...state, markedSkills: toggle(state.markedSkills, row.skillId) } : state
    }
    case 'toggle-stage-mark': {
      const stage = STAGE_ORDER[state.selectedStage]
      return stage ? { ...state, markedStages: toggle(state.markedStages, stage) } : state
    }
    case 'clear-marks':
      return { ...state, markedSkills: [], markedStages: [] }
    case 'set-focus':
      return { ...state, focus: action.focus }
    case 'cycle-focus':
      return { ...state, focus: FOCUSES[cycle(FOCUSES, state.focus, action.delta)] as Focus }
    case 'set-panel':
      return { ...state, panel: action.panel }
    case 'cycle-panel':
      return { ...state, panel: PANELS[cycle(PANELS, state.panel, action.delta)] as Panel }
    case 'set-skill-md':
      return { ...state, skillMd: action.body }
    case 'set-artefacts':
      return { ...state, artefacts: action.paths }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/store.test.ts`
Expected: PASS, eleven cases.

- [ ] **Step 5: Commit**

```bash
git add src/tui/store.ts tests/tui/store.test.ts
git commit -m "feat(tui): reduce core events into one screen state"
```

---

### Task 10: The Work screen

**Files:**
- Create: `src/tui/components/SkillList.tsx`, `src/tui/components/LifecycleRail.tsx`, `src/tui/components/OutputPane.tsx`, `src/tui/components/Work.tsx`, `src/tui/views.ts`
- Modify: `src/tui/app.tsx` (replacing the Task 7 placeholder)
- Test: `tests/tui/work-screen.test.tsx`

**Interfaces:**
- Consumes: `AppState`, `reducer`, `initialState`, `selectedSkill` (Task 9); `LogPump` (Task 8); `QueueHandle` (Task 3); `readIndex` through `src/core/index.js`.
- Produces: `SkillList`, `LifecycleRail`, `OutputPane`, `Work`, `App`; `loadSkillMd(dir)`, `listArtefacts(runDir)`, `loadSkillStatuses(skills)`.

R11.1: the skill list, the five-stage rail and the output pane are on screen at the same time, not behind a mode switch. The queue panel joins them in Task 12.

`App` owns three things and no more: the subscription to `queue.events`, the pump, and the keymap. Everything else is a pure function of `AppState`.

- [ ] **Step 1: Write the failing test**

`tests/tui/work-screen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue } from '../../src/core/index.js'
import type { SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]

function harness() {
  const runs = new Map<string, FakeRun>()
  const queue = createQueue({
    concurrency: 2,
    startRun: (job) => {
      const run = fakeRun(`run-${job.skillId}`)
      runs.set(job.jobId, run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App skills={SKILLS} queue={queue} stages={['security']} concurrency={2} intervalMs={20} />,
  )
  return { queue, runs, ui }
}

describe('Work screen', () => {
  it('shows the skill list, the lifecycle rail and the output pane at once — R11.1', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    const frame = ui.lastFrame()

    expect(frame).toContain('declawed')
    expect(frame).toContain('spec-lint')
    for (const stage of ['Validate', 'Evaluate', 'Security', 'Optimise', 'Release']) {
      expect(frame).toContain(stage)
    }
    expect(frame).toContain('Log')
    expect(frame).toContain('Findings')

    ui.unmount()
    queue.close()
  })

  it('moves the selection with j and k', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/›\s*[○◐●!×]\s*spec-lint/)
    ui.stdin.send('k')
    await ui.settle()
    expect(ui.lastFrame()).toMatch(/›\s*[○◐●!×]\s*declawed/)
    ui.unmount()
    queue.close()
  })

  it('renders live stage state as the engine reports it', async () => {
    const { ui, queue, runs } = harness()
    await ui.settle()
    const [jobId] = queue.enqueue([{ skill: SKILLS[0]!, stages: ['security'] }])
    await ui.settle()

    const run = runs.get(jobId!)!
    run.events.push({
      type: 'run:start',
      runId: 'run-declawed',
      skillId: 'declawed',
      stages: ['security'],
      runDir: '/w/run-declawed',
    })
    run.events.push({
      type: 'stage:done',
      runId: 'run-declawed',
      stage: 'security',
      outcome: 'failed',
      result: { stage: 'security', outcome: 'failed', verdict: 'failed', toolRuns: [] },
    })
    await ui.settle(60)

    expect(ui.lastFrame()).toContain('failed')
    run.finish({ outcome: 'failed' })
    await queue.idle()
    ui.unmount()
    queue.close()
  })

  it('renders streamed log lines through the pump, not per chunk', async () => {
    const { ui, queue, runs } = harness()
    await ui.settle()
    const [jobId] = queue.enqueue([{ skill: SKILLS[0]!, stages: ['security'] }])
    await ui.settle()

    const run = runs.get(jobId!)!
    run.events.push({
      type: 'run:start',
      runId: 'run-declawed',
      skillId: 'declawed',
      stages: ['security'],
      runDir: '/w/run-declawed',
    })
    for (let i = 0; i < 40; i += 1) {
      run.events.push({
        type: 'tool:output',
        runId: 'run-declawed',
        stage: 'security',
        toolId: 'skillspector',
        stream: 'stdout',
        chunk: `scanning file ${i}\n`,
      })
    }
    await ui.settle(80)

    expect(ui.lastFrame()).toContain('skillspector │ scanning file 39')
    run.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/work-screen.test.tsx`
Expected: FAIL — `App` is still the Task 7 placeholder.

- [ ] **Step 3: Write the filesystem views**

`src/tui/views.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readIndex, type SkillRef } from '../core/index.js'

export async function loadSkillMd(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return '(no SKILL.md)'
  }
}

/** Every file the run wrote, relative to the run directory, sorted. */
export async function listArtefacts(runDir: string | null): Promise<string[]> {
  if (!runDir) return []
  const out: string[] = []
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else out.push(rel)
    }
  }
  try {
    await walk(runDir, '')
  } catch {
    return []
  }
  return out.sort()
}

/**
 * Last recorded outcome per skill, read from each sidecar index rather than
 * the ledger: cross-repo ledger aggregates are M6, and the index is already
 * the per-skill record.
 */
export async function loadSkillStatuses(
  skills: readonly SkillRef[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const skill of skills) {
    const entries = await readIndex(skill.workspacePath).catch(() => [])
    const newest = entries.reduce<string | null>(
      (max, entry) => (max === null || entry.runId > max ? entry.runId : max),
      null,
    )
    const latest = entries.find((entry) => entry.runId === newest)
    if (latest) out[skill.id] = latest.outcome
  }
  return out
}
```

- [ ] **Step 4: Write the components**

`src/tui/components/SkillList.tsx`:

```tsx
import { Box, Text } from 'ink'
import type { SkillRow, SkillStatus } from '../store.js'

const MARK: Record<SkillStatus, string> = {
  idle: '○',
  running: '◐',
  passed: '●',
  failed: '!',
  errored: '×',
}

const COLOUR: Record<SkillStatus, string> = {
  idle: 'gray',
  running: 'cyan',
  passed: 'green',
  failed: 'red',
  errored: 'yellow',
}

export interface SkillListProps {
  skills: readonly SkillRow[]
  selected: number
  marked: readonly string[]
  focused: boolean
}

export function SkillList({ skills, selected, marked, focused }: SkillListProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={24}
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
    >
      <Text bold>Skills</Text>
      {skills.map((skill, index) => (
        <Text key={skill.skillId}>
          {index === selected ? '›' : ' '}
          {marked.includes(skill.skillId) ? '*' : ' '}
          <Text color={COLOUR[skill.status]}>{MARK[skill.status]}</Text> {skill.label}
        </Text>
      ))}
    </Box>
  )
}
```

`src/tui/components/LifecycleRail.tsx`:

```tsx
import { Box, Text } from 'ink'
import { STAGE_ORDER, type Stage } from '../../core/index.js'
import type { SkillRow } from '../store.js'

const LABEL: Record<Stage, string> = {
  validate: 'Validate',
  evaluate: 'Evaluate',
  security: 'Security',
  optimise: 'Optimise',
  release: 'Release',
}

export interface LifecycleRailProps {
  skill: SkillRow | undefined
  selected: number
  marked: readonly Stage[]
  focused: boolean
}

export function LifecycleRail({
  skill,
  selected,
  marked,
  focused,
}: LifecycleRailProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor={focused ? 'cyan' : 'gray'} flexDirection="column">
      <Box>
        {STAGE_ORDER.map((stage, index) => (
          <Box key={stage} marginRight={1}>
            <Text underline={index === selected} color={marked.includes(stage) ? 'cyan' : undefined}>
              {marked.includes(stage) ? '*' : ' '}
              {LABEL[stage]}
            </Text>
          </Box>
        ))}
      </Box>
      <Box>
        {STAGE_ORDER.map((stage) => {
          const cell = skill?.stages[stage]
          const text = cell?.running === true ? 'running' : (cell?.outcome ?? '·')
          return (
            <Box key={stage} marginRight={1} width={LABEL[stage].length + 1}>
              <Text dimColor>{text}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
```

`src/tui/components/OutputPane.tsx`:

```tsx
import { Box, Text } from 'ink'
import { PANELS, type AppState, type SkillRow } from '../store.js'

const TITLE: Record<(typeof PANELS)[number], string> = {
  log: 'Log',
  findings: 'Findings',
  artefacts: 'Artefacts',
  skill: 'SKILL.md',
}

/** Rows the pane body can show; the ring buffer holds far more than this. */
const VISIBLE = 12

export interface OutputPaneProps {
  state: AppState
  skill: SkillRow | undefined
  height?: number
}

export function OutputPane({ state, skill, height = VISIBLE }: OutputPaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1}>
      <Box>
        {PANELS.map((panel, index) => (
          <Box key={panel} marginRight={1}>
            <Text inverse={state.panel === panel}>
              {index + 1} {TITLE[panel]}
            </Text>
          </Box>
        ))}
      </Box>
      <Body state={state} skill={skill} height={height} />
    </Box>
  )
}

function Body({ state, skill, height }: Required<OutputPaneProps>): React.ReactElement {
  if (state.panel === 'log') {
    return (
      <Box flexDirection="column">
        {state.log.lines.slice(-height).map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
        {state.log.dropped > 0 && (
          <Text dimColor>
            {state.log.dropped} earlier lines dropped — full log under{' '}
            {skill?.runDir ?? skill?.workspacePath ?? 'the run directory'}
          </Text>
        )}
      </Box>
    )
  }

  if (state.panel === 'findings') {
    if (!skill || skill.findings.length === 0) return <Text dimColor>no findings</Text>
    return (
      <Box flexDirection="column">
        {skill.findings.slice(0, height).map((finding, index) => (
          <Text key={`${finding.path}-${finding.nativeRuleId}-${index}`}>
            <Text color="red">{finding.severity}</Text> {finding.ruleClass} {finding.path}{' '}
            {finding.message}
          </Text>
        ))}
      </Box>
    )
  }

  if (state.panel === 'artefacts') {
    if (state.artefacts.length === 0) return <Text dimColor>no artefacts yet</Text>
    return (
      <Box flexDirection="column">
        {state.artefacts.slice(0, height).map((path) => (
          <Text key={path}>{path}</Text>
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {state.skillMd.split('\n').slice(0, height).map((line, index) => (
        <Text key={`${index}-${line}`}>{line}</Text>
      ))}
    </Box>
  )
}
```

`src/tui/components/Work.tsx`:

```tsx
import { Box, Text } from 'ink'
import { selectedSkill, type AppState } from '../store.js'
import { LifecycleRail } from './LifecycleRail.js'
import { OutputPane } from './OutputPane.js'
import { SkillList } from './SkillList.js'

export function Work({ state }: { state: AppState }): React.ReactElement {
  const skill = selectedSkill(state)
  return (
    <Box flexDirection="column">
      <Text bold>
        SkillGantry — Work — concurrency {state.concurrency} — j/k skills, h/l stages, space marks,
        r runs, x cancels, tab focus, 1-4 panes, q quits
      </Text>
      <Box>
        <SkillList
          skills={state.skills}
          selected={state.selectedSkill}
          marked={state.markedSkills}
          focused={state.focus === 'skills'}
        />
        <Box flexDirection="column" flexGrow={1}>
          <LifecycleRail
            skill={skill}
            selected={state.selectedStage}
            marked={state.markedStages}
            focused={state.focus === 'stages'}
          />
          <OutputPane state={state} skill={skill} />
        </Box>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 5: Write the app**

`src/tui/app.tsx` (replacing the placeholder):

```tsx
import { useEffect, useReducer, useRef } from 'react'
import { useApp, useInput } from 'ink'
import type { QueueHandle, SkillRef, Stage } from '../core/index.js'
import { Work } from './components/Work.js'
import { LogPump } from './log-buffer.js'
import { PANELS, initialState, reducer, selectedSkill } from './store.js'
import { listArtefacts, loadSkillMd } from './views.js'

export interface AppProps {
  skills: readonly SkillRef[]
  queue: QueueHandle
  /** Stages enqueued when the user has marked none. */
  stages: readonly Stage[]
  concurrency: number
  /** Flush interval, lowered in tests. */
  intervalMs?: number
}

export function App({
  skills,
  queue,
  stages,
  concurrency,
  intervalMs,
}: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, skills, (list) =>
    initialState(list, concurrency),
  )
  const { exit } = useApp()
  const byId = useRef(new Map(skills.map((skill) => [skill.id, skill])))

  const pump = useRef<LogPump | null>(null)
  if (pump.current === null) {
    pump.current = new LogPump({
      ...(intervalMs === undefined ? {} : { intervalMs }),
      onFlush: (lines, dropped) => dispatch({ type: 'log-flush', lines, dropped }),
    })
  }

  useEffect(() => {
    const active = pump.current
    active?.start()
    let live = true
    void (async () => {
      for await (const event of queue.events) {
        if (!live) break
        // Log text goes to the buffer, never through the reducer — R11.4.
        if (event.type === 'run:event' && event.event.type === 'tool:output') {
          active?.write(event.event.toolId, event.event.chunk)
        } else {
          dispatch({ type: 'queue-event', event })
        }
      }
    })()
    return () => {
      live = false
      active?.stop()
    }
  }, [queue])

  const current = selectedSkill(state)
  useEffect(() => {
    if (!current) return
    if (state.panel === 'skill') {
      void loadSkillMd(current.dir).then((body) => dispatch({ type: 'set-skill-md', body }))
    }
    if (state.panel === 'artefacts') {
      void listArtefacts(current.runDir).then((paths) => dispatch({ type: 'set-artefacts', paths }))
    }
  }, [state.panel, current?.skillId, current?.runDir])

  useInput((input, key) => {
    if (input === 'q') {
      exit()
      return
    }
    if (key.tab) {
      dispatch({ type: 'cycle-focus', delta: key.shift ? -1 : 1 })
      return
    }
    if (input >= '1' && input <= '4') {
      dispatch({ type: 'set-panel', panel: PANELS[Number(input) - 1]! })
      return
    }
    if (input === 'j' || key.downArrow) {
      dispatch(state.focus === 'queue' ? { type: 'select-job', delta: 1 } : { type: 'select-skill', delta: 1 })
      return
    }
    if (input === 'k' || key.upArrow) {
      dispatch(state.focus === 'queue' ? { type: 'select-job', delta: -1 } : { type: 'select-skill', delta: -1 })
      return
    }
    if (input === 'h') {
      dispatch({ type: 'select-stage', delta: -1 })
      return
    }
    if (input === 'l') {
      dispatch({ type: 'select-stage', delta: 1 })
      return
    }
    if (input === ' ') {
      dispatch(state.focus === 'stages' ? { type: 'toggle-stage-mark' } : { type: 'toggle-skill-mark' })
      return
    }
    if (input === 'r') {
      // R5.5: every marked skill and stage becomes one batch, one call.
      const chosen = state.markedSkills.length > 0 ? state.markedSkills : [current?.skillId]
      const wanted = state.markedStages.length > 0 ? state.markedStages : stages
      const specs = chosen
        .flatMap((id) => (id ? [byId.current.get(id)] : []))
        .flatMap((skill) => (skill ? [{ skill, stages: wanted }] : []))
      if (specs.length > 0) queue.enqueue(specs)
      dispatch({ type: 'clear-marks' })
      return
    }
    if (input === 'x') {
      const job = state.jobs[state.selectedJob]
      if (job) void queue.cancelJob(job.jobId)
    }
  })

  return <Work state={state} />
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/work-screen.test.tsx`
Expected: PASS, four cases. The last one is R11.4 end to end: forty chunks produce one flush and one render, and the pane shows the newest line.

- [ ] **Step 7: Commit**

```bash
git add src/tui tests/tui/work-screen.test.tsx
git commit -m "feat(tui): render the work screen from live engine state"
```

---

### Task 11: The three non-log panes, over real files

**Files:**
- Modify: `src/tui/store.ts` (one action), `src/tui/app.tsx` (load statuses on mount)
- Test: `tests/tui/output-pane.test.tsx`

**Interfaces:**
- Consumes: `loadSkillMd`, `listArtefacts`, `loadSkillStatuses` (Task 10), `OutputPane`, `App` (Task 10), `makeRepo`/`SKILL_MD` (M1 Task 4), `claimRunDir`/`finalizeRun` (M1 Task 15).
- Produces: the `{ type: 'set-statuses'; statuses: Record<string, string> }` action, and an `App` whose skill list shows each skill's last recorded outcome before anything is run.

R11.2 names four views and Task 10 shipped their rendering. This task proves the three that read the disk, and closes the gap that made the skill list say `idle` for a skill with a hundred recorded runs — R11.1 asks for per-skill status, and status before the first run of a session can only come from the sidecar.

- [ ] **Step 1: Write the failing test**

`tests/tui/output-pane.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createQueue, discoverSkills, type SkillRef } from '../../src/core/index.js'
import { claimRunDir, finalizeRun } from '../../src/core/workspace/writer.js'
import { App } from '../../src/tui/app.js'
import { listArtefacts, loadSkillMd, loadSkillStatuses } from '../../src/tui/views.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { fakeRun } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'

async function fixture(): Promise<{ skills: SkillRef[]; runDir: string }> {
  const root = await makeRepo({
    files: {
      'declawed/SKILL.md': `${SKILL_MD('declawed', '1.1.0')}\nde-slop pass over any text.\n`,
    },
  })
  const skills = await discoverSkills({ id: 'fx', path: root, name: 'fx', isGit: false })
  const skill = skills[0]!
  const { runId, runDir } = await claimRunDir(skill.workspacePath)
  await mkdir(join(runDir, '03-security', 'skillspector'), { recursive: true })
  await writeFile(join(runDir, '03-security', 'skillspector', 'findings.sarif'), '{}')
  await writeFile(join(runDir, '03-security', 'skillspector', 'stdout.log'), 'scanning\n')
  await writeFile(join(runDir, 'run.json'), '{}')
  await finalizeRun(skill.workspacePath, {
    runId,
    outcome: 'failed',
    endedAt: '2026-08-01T00:00:00Z',
  })
  return { skills, runDir }
}

const harness = (skills: readonly SkillRef[]) => {
  const queue = createQueue({ concurrency: 1, startRun: (job) => fakeRun(job.jobId).handle })
  const ui = renderInk(
    <App skills={skills} queue={queue} stages={['security']} concurrency={1} intervalMs={20} />,
  )
  return { queue, ui }
}

describe('views', () => {
  it('reads SKILL.md and falls back when it is unreadable', async () => {
    const { skills } = await fixture()
    expect(await loadSkillMd(skills[0]!.dir)).toContain('de-slop pass')
    expect(await loadSkillMd('/nowhere')).toBe('(no SKILL.md)')
  })

  it('lists every artefact the run wrote, relative and sorted', async () => {
    const { runDir } = await fixture()
    const paths = await listArtefacts(runDir)
    expect(paths).toEqual([
      '03-security/skillspector/findings.sarif',
      '03-security/skillspector/stdout.log',
      'run.json',
    ])
    expect(await listArtefacts(null)).toEqual([])
  })

  it('reads the last recorded outcome per skill from the sidecar index', async () => {
    const { skills } = await fixture()
    expect(await loadSkillStatuses(skills)).toEqual({ 'fx/declawed': 'failed' })
  })
})

describe('output pane — R11.2', () => {
  it('shows SKILL.md on panel 4', async () => {
    const { skills } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle()
    ui.stdin.send('4')
    await ui.settle(60)
    expect(ui.lastFrame()).toContain('de-slop pass')
    ui.unmount()
    queue.close()
  })

  it('shows artefacts on panel 3 once a run directory is known', async () => {
    const { skills, runDir } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle()
    // The pane needs a run to point at, so replay the run:start the engine emits.
    const [jobId] = queue.enqueue([{ skill: skills[0]!, stages: ['security'] }])
    void jobId
    await ui.settle()
    ui.stdin.send('3')
    await ui.settle(60)
    expect(ui.lastFrame()).toMatch(/no artefacts yet|run\.json/)
    void runDir
    ui.unmount()
    queue.close()
  })

  it('shows findings on panel 2 and says so when there are none', async () => {
    const { skills } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle()
    ui.stdin.send('2')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('no findings')
    ui.unmount()
    queue.close()
  })

  it('points at the file on disk once the buffer has dropped lines — R11.5', async () => {
    const { skills } = await fixture()
    const runs = new Map<string, ReturnType<typeof fakeRun>>()
    const queue = createQueue({
      concurrency: 1,
      startRun: (job) => {
        const run = fakeRun(job.jobId)
        runs.set(job.jobId, run)
        return run.handle
      },
    })
    const ui = renderInk(
      <App skills={skills} queue={queue} stages={['security']} concurrency={1} intervalMs={20} />,
    )
    await ui.settle()
    const [jobId] = queue.enqueue([{ skill: skills[0]!, stages: ['security'] }])
    await ui.settle()

    const run = runs.get(jobId!)!
    run.events.push({
      type: 'run:start',
      runId: 'r1',
      skillId: skills[0]!.id,
      stages: ['security'],
      runDir: '/w/r1',
    })
    for (let i = 0; i < 2_500; i += 1) {
      run.events.push({
        type: 'tool:output',
        runId: 'r1',
        stage: 'security',
        toolId: 'skillspector',
        stream: 'stdout',
        chunk: `line ${i}\n`,
      })
    }
    await ui.settle(80)
    expect(ui.lastFrame()).toMatch(/\d+ earlier lines dropped/)

    run.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })

  it('shows the last recorded outcome before anything is run — R11.1', async () => {
    const { skills } = await fixture()
    const { ui, queue } = harness(skills)
    await ui.settle(60)
    expect(ui.lastFrame()).toMatch(/!\s*declawed/)
    ui.unmount()
    queue.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/output-pane.test.tsx`
Expected: FAIL — the last case shows `○ declawed`, because nothing loads recorded statuses.

- [ ] **Step 3: Add the action**

In `src/tui/store.ts`, add to `Action`:

```ts
  | { type: 'set-statuses'; statuses: Record<string, string> }
```

and to `reducer`:

```ts
    case 'set-statuses':
      return {
        ...state,
        skills: state.skills.map((row) => {
          const recorded = action.statuses[row.skillId]
          // A live run always wins over a record of an old one.
          if (recorded === undefined || row.status === 'running') return row
          return { ...row, status: statusOf(recorded as StageOutcome) }
        }),
      }
```

`statusOf` already collapses anything that is not `passed` or `failed` onto `errored`, so an unrecognised recorded value degrades rather than throwing.

- [ ] **Step 4: Load statuses on mount**

In `src/tui/app.tsx`, add the import and one effect:

```tsx
import { listArtefacts, loadSkillMd, loadSkillStatuses } from './views.js'
```

```tsx
  useEffect(() => {
    void loadSkillStatuses(skills).then((statuses) => dispatch({ type: 'set-statuses', statuses }))
  }, [skills])
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/tui/output-pane.test.tsx tests/tui/store.test.ts`
Expected: PASS, eight new cases plus Task 9's eleven.

- [ ] **Step 6: Commit**

```bash
git add src/tui/store.ts src/tui/app.tsx tests/tui/output-pane.test.tsx
git commit -m "feat(tui): back the findings, artefacts and SKILL.md panes with real files"
```

---

### Task 12: The queue panel and per-job cancellation

**Files:**
- Create: `src/tui/components/QueuePanel.tsx`
- Modify: `src/tui/components/Work.tsx`
- Test: `tests/tui/queue-panel.test.tsx`, `tests/tui/app-batch.test.tsx`

**Interfaces:**
- Consumes: `JobRecord` through `src/core/index.js`, `AppState` (Task 9), `Work` (Task 10).
- Produces: `QueuePanel`, and a Work screen that satisfies R11.6 and the display half of R5.10.

- [ ] **Step 1: Write the failing test**

`tests/tui/queue-panel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun, type FakeRun } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]

function harness(concurrency = 1) {
  const runs = new Map<string, FakeRun>()
  const queue = createQueue({
    concurrency,
    startRun: (job) => {
      const run = fakeRun(`run-${job.skillId}`)
      runs.set(job.jobId, run)
      return run.handle
    },
  })
  const ui = renderInk(
    <App skills={SKILLS} queue={queue} stages={['security']} concurrency={concurrency} intervalMs={20} />,
  )
  return { queue, runs, ui }
}

describe('queue panel — R5.10, R11.6', () => {
  it('shows queued and running jobs on the Work screen', async () => {
    const { ui, queue, runs } = harness(1)
    await ui.settle()
    const ids = queue.enqueue([
      { skill: SKILLS[0]!, stages: ['security'] },
      { skill: SKILLS[1]!, stages: ['security'] },
    ])
    await ui.settle(40)

    const frame = ui.lastFrame()
    expect(frame).toContain('Queue')
    expect(frame).toMatch(/running\s+declawed/)
    expect(frame).toMatch(/queued\s+spec-lint/)

    for (const id of ids) runs.get(id)?.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })

  it('cancels the selected job with x', async () => {
    const { ui, queue, runs } = harness(1)
    await ui.settle()
    const ids = queue.enqueue([
      { skill: SKILLS[0]!, stages: ['security'] },
      { skill: SKILLS[1]!, stages: ['security'] },
    ])
    await ui.settle(40)

    // Focus the queue, move to the second job, cancel it.
    ui.stdin.send('\t')
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send('x')
    await ui.settle(40)

    expect(queue.snapshot().queued).toEqual([])
    expect(queue.snapshot().completed.map((job) => job.state)).toContain('cancelled')
    expect(ui.lastFrame()).toMatch(/cancelled\s+spec-lint/)

    runs.get(ids[0]!)?.finish()
    await queue.idle()
    ui.unmount()
    queue.close()
  })
})
```

`tests/tui/app-batch.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import type { JobSpec, QueueHandle, SkillRef } from '../../src/core/index.js'
import { AsyncEventQueue } from '../../src/core/pipeline/queue.js'
import { App } from '../../src/tui/app.js'
import { renderInk } from '../helpers/render-ink.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'fx', path: '/repo', name: 'fx', isGit: false },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]

function recordingQueue(): { queue: QueueHandle; batches: JobSpec[][] } {
  const batches: JobSpec[][] = []
  const events = new AsyncEventQueue<never>()
  const queue: QueueHandle = {
    enqueue: (specs) => {
      batches.push([...specs])
      return specs.map((_spec, index) => `job-${batches.length}-${index}`)
    },
    snapshot: () => ({ concurrency: 2, queued: [], running: [], completed: [] }),
    cancelJob: vi.fn(async () => undefined),
    events: events as AsyncIterable<never>,
    idle: async () => undefined,
    close: () => events.close(),
  }
  return { queue, batches }
}

describe('batch enqueue — R5.5', () => {
  it('sends every marked skill and stage as one batch', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderInk(
      <App skills={SKILLS} queue={queue} stages={['security']} concurrency={2} intervalMs={20} />,
    )
    await ui.settle()

    ui.stdin.send(' ') // mark declawed
    await ui.settle()
    ui.stdin.send('j')
    ui.stdin.send(' ') // mark spec-lint
    await ui.settle()
    ui.stdin.send('\t') // focus stages
    await ui.settle()
    ui.stdin.send(' ') // mark validate
    await ui.settle()
    ui.stdin.send('l')
    ui.stdin.send(' ') // mark evaluate
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0]?.map((spec) => spec.skill.id).sort()).toEqual(['declawed', 'spec-lint'])
    expect(batches[0]?.[0]?.stages).toEqual(['validate', 'evaluate'])
    ui.unmount()
    queue.close()
  })

  it('falls back to the selected skill and the configured stages', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderInk(
      <App skills={SKILLS} queue={queue} stages={['security']} concurrency={2} intervalMs={20} />,
    )
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)

    expect(batches).toEqual([[{ skill: SKILLS[0], stages: ['security'] }]])
    ui.unmount()
    queue.close()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/tui/queue-panel.test.tsx tests/tui/app-batch.test.tsx`
Expected: FAIL — no panel renders the queue, so `Queue` is absent from every frame.

- [ ] **Step 3: Write the panel**

`src/tui/components/QueuePanel.tsx`:

```tsx
import { Box, Text } from 'ink'
import type { JobRecord } from '../../core/index.js'

const COLOUR: Record<JobRecord['state'], string> = {
  queued: 'gray',
  running: 'cyan',
  done: 'green',
  failed: 'red',
  cancelled: 'yellow',
}

export interface QueuePanelProps {
  jobs: readonly JobRecord[]
  selected: number
  concurrency: number
  focused: boolean
  rows?: number
}

export function QueuePanel({
  jobs,
  selected,
  concurrency,
  focused,
  rows = 5,
}: QueuePanelProps): React.ReactElement {
  const active = jobs.filter((job) => job.state === 'running').length
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
    >
      <Text bold>
        Queue {active}/{concurrency} running — x cancels
      </Text>
      {jobs.length === 0 && <Text dimColor>nothing queued</Text>}
      {jobs.slice(-rows).map((job, index) => (
        <Text key={job.jobId}>
          {index + Math.max(0, jobs.length - rows) === selected ? '›' : ' '}{' '}
          <Text color={COLOUR[job.state]}>{job.state}</Text> {job.skillId}{' '}
          <Text dimColor>{job.stages.join(',')}</Text>
        </Text>
      ))}
    </Box>
  )
}
```

- [ ] **Step 4: Put it on the Work screen**

In `src/tui/components/Work.tsx`, import the panel and add it below the output pane, inside the outer column:

```tsx
import { QueuePanel } from './QueuePanel.js'
```

```tsx
      <QueuePanel
        jobs={state.jobs}
        selected={state.selectedJob}
        concurrency={state.concurrency}
        focused={state.focus === 'queue'}
      />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/tui/queue-panel.test.tsx tests/tui/app-batch.test.tsx tests/tui/work-screen.test.tsx`
Expected: PASS, four new cases plus Task 10's four.

- [ ] **Step 6: Commit**

```bash
git add src/tui/components tests/tui/queue-panel.test.tsx tests/tui/app-batch.test.tsx
git commit -m "feat(tui): show the queue on the work screen with per-job cancellation"
```

---

### Task 13: Launch the terminal interface from the CLI

**Files:**
- Create: `src/cli/tui-command.ts`
- Modify: `src/cli/run-command.ts`, `src/cli/index.ts`
- Test: `tests/cli/tui-command.test.ts`

**Interfaces:**
- Consumes: `buildProgram`, `CliDeps`, `defaultDeps` (M1 Task 19); `createQueue` (Task 3); `renderApp` (Task 7); `runPipeline` (Task 1); `loadConfig`, `loadToolLock`, `loadEnvFile`, `provenanceOf`, `discoverSkills`, `openLedger` (M1).
- Produces: `startTui(options)`, `TuiOptions`, `resolveStages(config)`; `CliDeps.startTui?` as a test seam; a root `--concurrency <n>` option and a default action on `buildProgram`.

Design §2: `skillgantry` is the TUI and `skillgantry run …` is headless. This is the only place in M2 where config, credentials, the lockfile and the ledger are read, because the queue takes `startRun` as a function and the TUI takes a `QueueHandle`.

- [ ] **Step 1: Write the failing test**

`tests/cli/tui-command.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram } from '../../src/cli/run-command.js'
import { resolveStages } from '../../src/cli/tui-command.js'
import { DEFAULT_CONFIG } from '../../src/core/config/config.js'

const home = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sg-home-'))

describe('resolveStages', () => {
  it('offers only stages with a tool selected', () => {
    expect(
      resolveStages({
        ...DEFAULT_CONFIG,
        stageTools: { validate: [], evaluate: [], security: ['skillspector'], optimise: [] },
      }),
    ).toEqual(['security'])
  })

  it('keeps lifecycle order', () => {
    expect(
      resolveStages({
        ...DEFAULT_CONFIG,
        stageTools: {
          validate: ['skill-lint'],
          evaluate: [],
          security: ['skillspector'],
          optimise: [],
        },
      }),
    ).toEqual(['validate', 'security'])
  })
})

describe('default command', () => {
  it('starts the terminal interface when no subcommand is given', async () => {
    const startTui = vi.fn(async () => undefined)
    const h = await home()
    const program = buildProgram({ home: h, dbPath: join(h, 'gantry.db'), write: () => {}, startTui })
    await program.parseAsync(['node', 'skillgantry'])
    expect(startTui).toHaveBeenCalledWith(
      expect.objectContaining({ home: h, dbPath: join(h, 'gantry.db') }),
    )
  })

  it('passes --concurrency through', async () => {
    const startTui = vi.fn(async () => undefined)
    const h = await home()
    const program = buildProgram({ home: h, dbPath: join(h, 'gantry.db'), write: () => {}, startTui })
    await program.parseAsync(['node', 'skillgantry', '--concurrency', '4'])
    expect(startTui).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 4 }))
  })

  it('leaves the run subcommand alone', async () => {
    const startTui = vi.fn(async () => undefined)
    const h = await home()
    await writeFile(join(h, 'config.json'), JSON.stringify(DEFAULT_CONFIG))
    const program = buildProgram({ home: h, dbPath: join(h, 'gantry.db'), write: () => {}, startTui })
    await expect(
      program.parseAsync(['node', 'skillgantry', 'run', 'nothing', '--stage', 'security']),
    ).rejects.toThrow(/no skill matching/)
    expect(startTui).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/cli/tui-command.test.ts`
Expected: FAIL — module not found, and `buildProgram` has no default action.

- [ ] **Step 3: Write the wiring**

`src/cli/tui-command.ts`:

```ts
import {
  createQueue,
  discoverSkills,
  loadConfig,
  loadEnvFile,
  loadToolLock,
  openLedger,
  provenanceOf,
  runPipeline,
  STAGE_ORDER,
  type GantryConfig,
  type SkillRef,
  type Stage,
} from '../core/index.js'
import { renderApp } from '../tui/index.js'

export interface TuiOptions {
  home: string
  dbPath: string
  concurrency?: number
}

/** Stages with at least one tool selected, in lifecycle order. */
export function resolveStages(config: GantryConfig): Stage[] {
  return STAGE_ORDER.filter((stage) => (config.stageTools[stage] ?? []).length > 0)
}

export async function startTui(options: TuiOptions): Promise<void> {
  const config = await loadConfig(options.home)
  const lock = await loadToolLock(options.home)
  const env = await loadEnvFile(options.home)

  const skills: SkillRef[] = []
  for (const repo of config.repos) skills.push(...(await discoverSkills(repo)))

  const ledger = openLedger(options.dbPath)
  const concurrency = options.concurrency ?? config.concurrency

  const queue = createQueue({
    concurrency,
    startRun: (_job, spec) =>
      runPipeline({
        skill: spec.skill,
        stages: spec.stages,
        trigger: spec.trigger ?? 'tui',
        stageTools: config.stageTools,
        lock,
        ledger,
        env: { ...process.env, ...env.vars },
        secrets: env.secrets,
        provenance: provenanceOf(env.vars),
        artefactSizeCapBytes: config.artefactSizeCapBytes,
        timeoutOverridesMs: config.timeoutOverridesMs,
        mutationTimeoutMs: config.mutationTimeoutMs,
      }),
  })

  try {
    await renderApp({
      skills,
      queue,
      stages: resolveStages(config),
      concurrency,
    })
  } finally {
    queue.close()
    ledger.close()
  }
}
```

`renderApp` is imported from `src/tui/index.js`, which is the only direction `cli → tui → core` allows.

In `src/cli/run-command.ts`, add the import, extend `CliDeps`, and give the program a default action:

```ts
import { startTui, type TuiOptions } from './tui-command.js'
```

```ts
export interface CliDeps {
  home: string
  dbPath: string
  write: (line: string) => void
  /** Test seam. Defaults to the real terminal interface. */
  startTui?: (options: TuiOptions) => Promise<void>
}
```

At the end of `buildProgram`, before `return program`:

```ts
  program
    .option('--concurrency <n>', 'worker pool limit for this session', (value) => Number(value))
    .action(async (opts: { concurrency?: number }) => {
      // Commander runs this only when no subcommand matched.
      const launch = deps.startTui ?? startTui
      await launch({
        home: deps.home,
        dbPath: deps.dbPath,
        ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
      })
    })
```

`src/cli/index.ts` needs no change: it already builds the program and parses. Confirm it reads:

```ts
#!/usr/bin/env node
import { buildProgram, defaultDeps } from './run-command.js'

const program = buildProgram(defaultDeps())
await program.parseAsync(process.argv)
process.exitCode = program.exitCode ?? 0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/cli/tui-command.test.ts tests/cli/run-command.test.ts`
Expected: PASS, five new cases plus M1's eight.

- [ ] **Step 5: Verify by hand against a real repo**

Run:

```bash
pnpm build
node dist/cli/index.js --concurrency 1
```

Expected: the Work screen renders with every registered repo's skills, `j`/`k` move, `r` enqueues, `q` quits. This is the one part of M2 no test can fully stand in for.

- [ ] **Step 6: Commit**

```bash
git add src/cli tests/cli/tui-command.test.ts
git commit -m "feat(cli): launch the work screen when no subcommand is given"
```

---

### Task 14: M2 acceptance suite

**Files:**
- Create: `tests/acceptance/m2.test.ts`
- Test: the file above

**Interfaces:**
- Consumes: everything M1 and M2 ship.
- Produces: one named test per M2 exit criterion. A criterion not demonstrated here is not met.

The M2 exit criteria, from [requirements.md](requirements.md#milestone-ownership):

> Work screen renders live state over the M1 engine without changing any M1 interface — the queue, command path and per-skill locking that M2 adds are additive; two concurrent runs on one skill finalise without loss and agree on `latest` under inverted finish order; a dead holder's lock is reclaimed; cancellation works in all four phases.

The cross-process halves of R6.7 and R6.9 live in Task 5 and are not duplicated here; this file asserts the same properties through the real pipeline, which is the path a user takes.

- [ ] **Step 1: Write the acceptance suite**

`tests/acceptance/m2.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createQueue,
  discoverSkills,
  runPipeline,
  type RunEvent,
  type SkillRef,
} from '../../src/core/index.js'
import { openLedger } from '../../src/core/ledger/db.js'
import type { RunPipelineInput } from '../../src/core/pipeline/run.js'
import { App } from '../../src/tui/app.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { makeFakeTool } from '../helpers/fake-tool.js'
import { fakeExecutor } from '../helpers/fake-executor.js'
import { renderInk } from '../helpers/render-ink.js'

const SARIF_EMPTY = JSON.stringify({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'skillspector', version: '2.3.7' } }, results: [] }],
})

async function fixture(script: string): Promise<{ skill: SkillRef; input: RunPipelineInput }> {
  const repoPath = await makeRepo({ files: { 'declawed/SKILL.md': SKILL_MD('declawed', '1.1.0') } })
  const [skill] = await discoverSkills({ id: 'fx', path: repoPath, name: 'fx', isGit: false })
  const bin = await makeFakeTool('skillspector', script)
  return {
    skill: skill!,
    input: {
      skill: skill!,
      stages: ['security'],
      trigger: 'acceptance',
      stageTools: { security: ['skillspector'] },
      lock: {
        version: 1,
        tools: {
          skillspector: {
            installKind: 'uv-tool',
            requestedPin: '2.3.7',
            resolvedVersion: '2.3.7',
            bin,
            integrity: 'n/a',
            installedAt: '2026-08-01T00:00:00Z',
            verifiedAt: '2026-08-01T00:00:00Z',
          },
        },
      },
      ledger: openLedger(':memory:'),
      env: {},
      secrets: [],
      provenance: { baseUrlHost: null, models: {}, authTokenHash: null },
      artefactSizeCapBytes: 1024 * 1024,
      timeoutOverridesMs: {},
    },
  }
}

const drain = async (events: AsyncIterable<RunEvent>, sink: RunEvent[] = []): Promise<RunEvent[]> => {
  for await (const event of events) sink.push(event)
  return sink
}

describe('M2 exit criteria', () => {
  it('renders live engine state on the Work screen', async () => {
    const { skill, input } = await fixture(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const queue = createQueue({
      concurrency: 2,
      startRun: (_job, spec) => runPipeline({ ...input, skill: spec.skill, stages: spec.stages }),
    })
    const ui = renderInk(
      <App skills={[skill]} queue={queue} stages={['security']} concurrency={2} intervalMs={20} />,
    )
    await ui.settle()

    queue.enqueue([{ skill, stages: ['security'] }])
    await queue.idle()
    await ui.settle(120)

    expect(ui.lastFrame()).toContain('passed')
    expect(ui.lastFrame()).toContain('Queue')
    ui.unmount()
    queue.close()
    input.ledger.close()
  }, 30_000)

  it('adds only additive surface to the M1 engine', async () => {
    const { input } = await fixture(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    // The M1 input shape, with none of M2's optional fields.
    const handle = runPipeline(input)
    const events = await drain(handle.events)
    const summary = await handle.done

    expect(events.map((e) => e.type)).toEqual([
      'run:start',
      'stage:start',
      'tool:start',
      'tool:done',
      'stage:done',
      'run:done',
    ])
    expect(summary.outcome).toBe('passed')
    expect(typeof handle.resolveMutation).toBe('function')
    input.ledger.close()
  }, 30_000)

  it('loses no index entry when two runs on one skill finalise together — R6.7', async () => {
    const { skill, input } = await fixture(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
    const first = runPipeline(input)
    const second = runPipeline(input)
    await Promise.all([drain(first.events), drain(second.events)])
    const [a, b] = await Promise.all([first.done, second.done])

    const index = await readFile(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'), 'utf8')
    const ids = index
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { runId: string }).runId)
    expect(new Set(ids)).toEqual(new Set([a.runId, b.runId]))
    expect(a.runDir).not.toBe(b.runDir)

    const newest = [a.runId, b.runId].sort().at(-1)
    expect(await readlink(join(skill.workspacePath, 'skillgantry/runs/latest'))).toContain(newest!)
    input.ledger.close()
  }, 30_000)

  it('cancels a queued job before anything spawns — phase 1', async () => {
    const { skill, input } = await fixture('sleep 600')
    const started: string[] = []
    const queue = createQueue({
      concurrency: 1,
      startRun: (_job, spec) => {
        started.push(spec.skill.id)
        return runPipeline({ ...input, skill: spec.skill, stages: spec.stages })
      },
    })
    const ids = queue.enqueue([
      { skill, stages: ['security'] },
      { skill, stages: ['security'] },
    ])
    await new Promise((r) => setTimeout(r, 50))
    await queue.cancelJob(ids[1]!)

    expect(started).toHaveLength(1)
    await queue.cancelJob(ids[0]!)
    await queue.idle()
    queue.close()
    input.ledger.close()
  }, 30_000)

  it('cancels a running tool and keeps its evidence — phase 2', async () => {
    const { skill, input } = await fixture('echo scanning; sleep 600')
    const seen: RunEvent[] = []
    const handle = runPipeline(input)
    const draining = drain(handle.events, seen)
    while (!seen.some((e) => e.type === 'tool:start')) {
      await new Promise((r) => setTimeout(r, 10))
    }
    await handle.cancel('acceptance')
    await draining
    const summary = await handle.done

    expect(seen.find((e) => e.type === 'run:cancelled')).toMatchObject({ phase: 'running' })
    expect(summary.stages[0]?.toolRuns[0]).toMatchObject({ errorKind: 'cancelled' })
    const index = await readFile(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'), 'utf8')
    expect(index.trim().split('\n')).toHaveLength(1)
    input.ledger.close()
  }, 30_000)

  it('cancels while awaiting mutation approval — phase 3', async () => {
    const { input } = await fixture('exit 0')
    const calls: string[] = []
    const seen: RunEvent[] = []
    const handle = runPipeline({
      ...input,
      stages: ['optimise'],
      stageTools: { optimise: ['fake'] },
      mutationTimeoutMs: 60_000,
      executorFactory: (stage) =>
        fakeExecutor(stage, {
          mutating: true,
          pending: { diff: 'diff', scope: ['declawed/SKILL.md'] },
          calls,
        }),
    })
    const draining = drain(handle.events, seen)
    while (!seen.some((e) => e.type === 'mutation:pending')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    await handle.cancel('acceptance')
    await draining
    const summary = await handle.done

    expect(seen.find((e) => e.type === 'run:cancelled')).toMatchObject({
      phase: 'awaiting-approval',
    })
    expect(calls).toContain('discard:optimise')
    expect(summary.stages[0]?.outcome).toBe('skipped')
    input.ledger.close()
  }, 30_000)

  it('completes finalisation when cancelled during it — phase 4', async () => {
    const { skill, input } = await fixture('exit 0')
    const seen: RunEvent[] = []
    const handle = runPipeline({ ...input, executorFactory: (s) => fakeExecutor(s) })
    const draining = drain(handle.events, seen)
    while (!seen.some((e) => e.type === 'stage:done')) {
      await new Promise((r) => setTimeout(r, 5))
    }
    await handle.cancel('acceptance')
    await draining
    const summary = await handle.done

    // Whichever phase the request landed in, the run finalised.
    expect(seen.at(-1)?.type).toBe('run:done')
    expect(summary.runId).toBeTruthy()
    const index = await readFile(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'), 'utf8')
    expect(index.trim().split('\n')).toHaveLength(1)
    input.ledger.close()
  }, 30_000)

  it('holds ten thousand lines without ten thousand renders — R11.4', async () => {
    const { skill, input } = await fixture(
      `i=0; while [ $i -lt 10000 ]; do echo "scanning $i"; i=$((i+1)); done; printf '%s' '${SARIF_EMPTY}' > "$7"`,
    )
    const queue = createQueue({
      concurrency: 1,
      startRun: (_job, spec) => runPipeline({ ...input, skill: spec.skill, stages: spec.stages }),
    })
    const ui = renderInk(
      <App skills={[skill]} queue={queue} stages={['security']} concurrency={1} intervalMs={100} />,
    )
    await ui.settle()
    const before = ui.frames.length

    const startedAt = Date.now()
    queue.enqueue([{ skill, stages: ['security'] }])
    await queue.idle()
    await ui.settle(150)
    const elapsedMs = Date.now() - startedAt

    // One render per 100 ms tick, plus a handful for stage and job transitions.
    const renders = ui.frames.length - before
    expect(renders).toBeLessThan(Math.ceil(elapsedMs / 100) + 20)
    expect(renders).toBeLessThan(200)

    // Input still lands, and the full log is on disk — R11.5.
    ui.stdin.send('2')
    await ui.settle(60)
    expect(ui.lastFrame()).toContain('Findings')

    const summary = queue.snapshot().completed[0]
    expect(summary?.state).toBe('done')
    const log = await readFile(
      join(skill.workspacePath, 'skillgantry/runs', summary!.runId!, '03-security/skillspector/stdout.log'),
      'utf8',
    )
    expect(log.trim().split('\n')).toHaveLength(10_000)

    ui.unmount()
    queue.close()
    input.ledger.close()
  }, 60_000)
})
```

- [ ] **Step 2: Run the suite**

Run: `pnpm vitest run tests/acceptance/m2.test.ts`
Expected: PASS, eight cases. `pnpm acceptance` already points at `tests/acceptance`, so M1's suite and this one run together.

- [ ] **Step 3: Run everything**

Run: `pnpm check && pnpm acceptance`
Expected: lint, build, the full unit suite and both acceptance suites green.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/m2.test.ts
git commit -m "test: demonstrate every M2 exit criterion"
```

---

## Requirement coverage for M2

Every requirement M2 owns, and the task that satisfies it. A requirement with no task is a plan defect.

| Requirement | Task |
|---|---|
| R5.3 any stage in isolation, any completed stage re-runnable | 3 (queue), 14 (real pipeline, two runs of one skill) |
| R5.4 no automatic optimise → validate loop | 2 (pipeline never re-enters), 3 (queue never self-enqueues) |
| R5.5 multi-skill, multi-stage batch enqueue | 3 (`enqueue(specs[])`), 12 (marks and one call from the screen) |
| R5.6 bounded pool, configurable, default 2 | 3 (`concurrency`), 13 (`--concurrency`, config fallback) |
| R5.7 mutating stages serialised regardless of the limit | 3 (single mutation slot) |
| R5.8 one skill's failure does not stop the others | 3 (`drive` contains every rejection) |
| R5.10 queue visible, queued and running jobs cancellable | 3 (`snapshot`), 4 (`cancelJob`), 12 (panel and key) |
| R5.12 command path beside the event stream | 1 (`cancel`), 2 (`resolveMutation` by correlation id), 4 (`cancelJob`) |
| R5.13 cancellation in four phases, run still finalises | 1 (running, finalising), 2 (awaiting approval), 4 (queued), 14 (all four) |
| R5.14 unresolved mutation times out and discards | 2 |
| R6.7 concurrent runs on one skill | 5 (cross-process), 14 (through the pipeline) |
| R6.9 lock released when its holder dies, reclaim logged | 5 |
| R11.1 skill list, lifecycle rail and output pane at once | 10, 11 (status before the first run) |
| R11.2 Log, Findings, Artefacts and SKILL.md views | 10 (rendering), 11 (real files) |
| R11.4 ring buffer outside React, fixed-interval flush | 8 (buffer and pump), 9 (reducer refuses log text), 10, 14 (10,000 lines) |
| R11.5 full log on disk when the buffer has dropped lines | 6 (runner still writes every byte), 11 (the pane says so), 14 |
| R11.6 queue visible from the Work screen with per-job cancel | 12 |

**Owned elsewhere but touched here.** R11.3's top-level screens are M6; M2 ships Work alone. R5.2's diff-before-write and R12.4's `--yes` are M5; M2 ships the gate they run through and no mutating stage. R13.1 is M1's, and Task 7 extends its lint rule to the new consumer rather than restating the requirement.

**Changed in M1's files, and why.** `runTool` gains `onChunk` and `AdapterStageExecutor` forwards it (Task 6) because R11.4 cannot be met by a frontend that learns everything after the process exits. `withSkillLock`'s reclaim listener gains a reason and a default that writes a log (Task 5) because R6.9 requires the reclaim to be logged and M1's default discards it. Every other edit stays inside the additive rule stated in the constraints.

## Self-review

**Spec coverage.** Every requirement in M2's row of the ownership table maps to a task above, and each of the four exit criteria has a named acceptance test in Task 14.

**Placeholders.** Task 7 creates a deliberately named placeholder `src/tui/app.tsx` so `index.tsx` compiles before Task 10 exists; both tasks say so. Nothing else is deferred, and no step describes work without showing it.

**Type consistency.** `RunHandle.cancel` returns `Promise<void>` from Task 1 onward and every caller awaits it. `QueueHandle` is defined once in Task 3 and implemented once in `createQueue`; the fake in Task 12's batch test implements the same six members. `JobRecord.state` is the same five-value union in the pool, the store and the panel. `fakeExecutor(stage, options)` keeps its two parameters across Tasks 1, 2 and 14, and Task 2 extends it rather than redefining it. `LogPump.write(source, chunk)` takes the tool id as its source in Task 8, Task 10 and Task 14. `initialState(skills, concurrency)` has the same two parameters in Task 9 and Task 10. `PendingMutation` is declared once, in Task 2's edit to `src/core/stages/types.ts`, and imported everywhere else.

**Scope.** Fourteen tasks, one milestone, one working deliverable: a terminal interface driving a queue over the M1 engine. No wizard, no doctor, no second adapter, no isolation, no release.

## Known gaps carried into M3 and M5

Recorded so they are not mistaken for oversights.

- **Read-only and mutating jobs for one skill can overlap.** R5.7 asks only that mutating stages serialise, and the single mutation slot delivers that. A mutating job writing a skill while a read-only job scans it is an isolation question, and isolation is M5's module.
- **The gate has no diff renderer.** `mutation:pending` carries a unified diff and the TUI does not yet display it, because no stage produces one until M5. M5 adds the review pane and the confirmation key.
- **The Work screen is the only screen.** `1`–`4` switch output panels, not top-level screens. Dashboard, Issues and Tools are R11.3 and M6.
- **`loadSkillStatuses` reads sidecar indexes, not the ledger.** Cross-repo aggregates need ledger queries, which are M6. Reading one index per skill is fine for the tens of skills in the reference repos and would not be for thousands.

## Deviations found while implementing

Each one is a place the plan as written did not survive contact with the shipped code or the installed library. All are in the branch.

- **Ink 6 reads input through `readable` + `read()`, not `data`.** The Task 7 fake stdin delivered no keypress at all. `tests/helpers/render-ink.tsx` now backs `FakeStdin` with a queue and emits `readable` (and implements `unshift`).
- **`runTool` ignored an already-aborted signal.** It attached an `abort` listener after spawning, so a cancel landing in the window between `tool:start` and the listener left the tool running to its timeout. `spawn.ts` now re-checks `signal.aborted` after attaching. Task 1's first case fails intermittently without it.
- **`withSkillLock` crashed on an empty lockfile.** Creating the file and writing its holder are two steps, so a second *process* can read it empty and `JSON.parse('')` threw. An unreadable body now means "holder unknown", reclaimable only by the lease. Task 5's cross-process case is what exposed this; no in-process test could.
- **`createQueue` needed delivery barriers.** `idle()` and the queued branch of `cancelJob` resolved before the events they had just pushed reached a consumer, so Task 3 and Task 4 assertions raced. Both now defer resolution by one macrotask.
- **The queue test harnesses create their fake runs lazily.** As written they built a `FakeRun` inside `startRun`, so a test finishing a whole batch in one loop could never settle the job that had not started yet, and `idle()` hung. `queue.test.ts`, `queue-cancel.test.ts` and `queue-panel.test.tsx` create the run on first access by job id instead.
- **`resolveStages` must tolerate a missing `release` key.** `stageTools` has no `release` entry — release is native — so indexing it by `Stage` does not type-check.
- **`LifecycleRail` passes `color` by spread.** `exactOptionalPropertyTypes` rejects `color={cond ? 'cyan' : undefined}`.
- **The M2 acceptance suite is `tests/acceptance/m2.test.tsx`.** It renders `<App />`, so it cannot be a `.ts` file.
- **`tests/core/spawn.test.ts`'s partial-output timeout is 3s, not 1s.** An M1 test, flaky before this branch and more so as the suite grew: the assertion is that a kill preserves what was already written, and a cold shell can take over a second to emit its first line.
- **Task 13's manual check is unrun.** `node dist/cli/index.js` renders the Work screen, then Ink throws `Raw mode is not supported` because this session has no TTY. Needs a human at a terminal.

## Execution

Plan saved to `docs/specs/plan-m2.md`. Two execution options:

**1. Subagent-driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline execution** — tasks executed in this session with batched checkpoints.
