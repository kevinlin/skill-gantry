import { describe, expect, it } from 'vitest'
import { AdapterStageExecutor } from '../../src/core/stages/adapter-stage.js'
import { adaptersForStage, getAdapter, listAdapters } from '../../src/core/adapters/registry.js'
import type { Adapter } from '../../src/core/adapters/types.js'
import type { StageContext } from '../../src/core/stages/types.js'

const ctx = (stage: StageContext['stage'], ids: string[]): StageContext =>
  ({ stage, selectedToolIds: ids }) as unknown as StageContext

const withPolicy = (id: string, stage: string, policy: 'fan-out' | 'pick-one'): Adapter => ({
  manifest: { ...(getAdapter('skillspector') as Adapter).manifest, id, stage: stage as never, policy },
  parse: () => ({ outcome: 'passed', findings: [], metrics: {}, summary: '' }),
})

describe('plan() policy resolution', () => {
  it('fans out when every selected tool fans out — R4.6', async () => {
    const plan = await new AdapterStageExecutor('security').plan(
      ctx('security', ['skillspector', 'skill-scanner']),
    )
    expect(plan.policy).toBe('fan-out')
    expect(plan.toolIds).toEqual(['skillspector', 'skill-scanner'])
  })

  it('rejects more than one tool for a pick-one stage — R4.7', async () => {
    const lookup = (id: string): Adapter | undefined =>
      id.startsWith('e') ? withPolicy(id, 'evaluate', 'pick-one') : undefined
    await expect(
      new AdapterStageExecutor('evaluate', { lookup }).plan(ctx('evaluate', ['e1', 'e2'])),
    ).rejects.toThrow(/exactly one tool/)
  })

  it('rejects a pick-one tool listed before a fan-out one', async () => {
    // The bug this test exists for: policy was taken from the last adapter in
    // the loop, so a pick-one tool followed by a fan-out one resolved to
    // fan-out and both ran concurrently. R4.8 forbids exactly that for optimise.
    const lookup = (id: string): Adapter | undefined =>
      id === 'one' ? withPolicy('one', 'optimise', 'pick-one')
      : id === 'many' ? withPolicy('many', 'optimise', 'fan-out')
      : undefined
    await expect(
      new AdapterStageExecutor('optimise', { lookup }).plan(ctx('optimise', ['one', 'many'])),
    ).rejects.toThrow(/exactly one tool|disagree/)
  })

  it('rejects an empty selection before the run starts — R4.11', async () => {
    await expect(new AdapterStageExecutor('security').plan(ctx('security', []))).rejects.toThrow(
      /no tools selected/,
    )
  })
})

describe('optimise concurrency — R4.8', () => {
  it('ships no optimise adapter, so no run can select two', () => {
    expect(adaptersForStage('optimise')).toEqual([])
  })

  it('would serialise one if it existed: every optimise manifest is pick-one and mutating', () => {
    for (const a of listAdapters()) {
      if (a.manifest.stage !== 'optimise') continue
      expect(a.manifest.policy).toBe('pick-one')
      expect(a.manifest.mutating).toBe(true)
    }
  })
})
