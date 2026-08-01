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
