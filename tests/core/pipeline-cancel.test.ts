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
    const index = await readFile(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'), 'utf8')
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
    const index = await readFile(join(skill.workspacePath, 'skillgantry/runs/index.ndjson'), 'utf8')
    expect(index.trim().split('\n')).toHaveLength(1)
    input.ledger.close()
  })
})
