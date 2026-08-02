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

const drain = async (
  events: AsyncIterable<RunEvent>,
  sink: RunEvent[] = [],
): Promise<RunEvent[]> => {
  for await (const event of events) sink.push(event)
  return sink
}

describe('M2 exit criteria', () => {
  it(
    'renders live engine state on the Work screen',
    async () => {
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
    },
    30_000,
  )

  it(
    'adds only additive surface to the M1 engine',
    async () => {
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
    },
    30_000,
  )

  it(
    'loses no index entry when two runs on one skill finalise together — R6.7',
    async () => {
      const { skill, input } = await fixture(`printf '%s' '${SARIF_EMPTY}' > "$7"`)
      const first = runPipeline(input)
      const second = runPipeline(input)
      await Promise.all([drain(first.events), drain(second.events)])
      const [a, b] = await Promise.all([first.done, second.done])

      const index = await readFile(
        join(skill.workspacePath, 'skillgantry/runs/index.ndjson'),
        'utf8',
      )
      const ids = index
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { runId: string }).runId)
      expect(new Set(ids)).toEqual(new Set([a.runId, b.runId]))
      expect(a.runDir).not.toBe(b.runDir)

      const newest = [a.runId, b.runId].sort().at(-1)
      expect(await readlink(join(skill.workspacePath, 'skillgantry/runs/latest'))).toContain(newest!)
      input.ledger.close()
    },
    30_000,
  )

  it(
    'cancels a queued job before anything spawns — phase 1',
    async () => {
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
    },
    30_000,
  )

  it(
    'cancels a running tool and keeps its evidence — phase 2',
    async () => {
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
      const index = await readFile(
        join(skill.workspacePath, 'skillgantry/runs/index.ndjson'),
        'utf8',
      )
      expect(index.trim().split('\n')).toHaveLength(1)
      input.ledger.close()
    },
    30_000,
  )

  it(
    'cancels while awaiting mutation approval — phase 3',
    async () => {
      const { input } = await fixture('exit 0')
      const calls: string[] = []
      const seen: RunEvent[] = []
      const handle = runPipeline({
        ...input,
        stages: ['optimise'],
        stageTools: { optimise: ['fake'] },
        mutationTimeoutMs: 60_000,
        // The gate is reached only when the run is authorised (R12.4).
        authorised: true,
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
    },
    30_000,
  )

  it(
    'completes finalisation when cancelled during it — phase 4',
    async () => {
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
      const index = await readFile(
        join(skill.workspacePath, 'skillgantry/runs/index.ndjson'),
        'utf8',
      )
      expect(index.trim().split('\n')).toHaveLength(1)
      input.ledger.close()
    },
    30_000,
  )

  it(
    'holds ten thousand lines without ten thousand renders — R11.4',
    async () => {
      const { skill, input } = await fixture(
        `i=0; while [ $i -lt 10000 ]; do echo "scanning $i"; i=$((i+1)); done; printf '%s' '${SARIF_EMPTY}' > "$7"`,
      )
      const queue = createQueue({
        concurrency: 1,
        startRun: (_job, spec) => runPipeline({ ...input, skill: spec.skill, stages: spec.stages }),
      })
      const ui = renderInk(
        <App
          skills={[skill]}
          queue={queue}
          stages={['security']}
          concurrency={1}
          intervalMs={100}
        />,
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
        join(
          skill.workspacePath,
          'skillgantry/runs',
          summary!.runId!,
          '03-security/skillspector/stdout.log',
        ),
        'utf8',
      )
      expect(log.trim().split('\n')).toHaveLength(10_000)

      ui.unmount()
      queue.close()
      input.ledger.close()
    },
    60_000,
  )
})
