import { describe, expect, it } from 'vitest'
import { discoverSkills } from '../../src/core/discovery/discover.js'
import { openLedger } from '../../src/core/ledger/db.js'
import { runPipeline, type RunPipelineInput } from '../../src/core/pipeline/run.js'
import type { RunEvent } from '../../src/core/pipeline/events.js'
import { SKILL_MD, makeRepo } from '../helpers/tmp-repo.js'
import { fakeExecutor } from '../helpers/fake-executor.js'

const PENDING = {
  diff: '--- a/SKILL.md\n+++ b/SKILL.md\n@@\n-old\n+new\n',
  scope: ['declawed/SKILL.md'],
}

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
