import { describe, expect, it } from 'vitest'
import type { SuppressionRequest } from '../../src/core/index.js'
import { initialState, reducer } from '../../src/tui/store.js'

const request: SuppressionRequest = {
  kind: 'finding',
  skillId: 'fx/declawed',
  toolId: 'skillspector',
  nativeRuleId: 'MP2',
  relPath: 'declawed/scripts/scan.py',
  reason: '',
}

const open = (reason: string) =>
  reducer(initialState([], 2), {
    type: 'begin-suppress',
    request,
    toolId: 'skillspector',
    relPath: 'declawed/scripts/scan.py',
    reason,
  })

describe('R11.16 suppression slot', () => {
  it('opens with the reason editor active and the prefill in the buffer', () => {
    const state = open('Accepted 2026-08-09 via SkillGantry')
    expect(state.suppress?.editingReason).toBe(true)
    expect(state.suppress?.reason).toBe('Accepted 2026-08-09 via SkillGantry')
    expect(state.suppress?.request).toEqual(request)
  })

  it('refuses to leave the editor with an empty reason', () => {
    let state = open('')
    state = reducer(state, { type: 'suppress-reason', reason: '   ' })
    state = reducer(state, { type: 'commit-suppress-reason' })
    expect(state.suppress?.editingReason).toBe(true)
    expect(state.suppress?.error).toContain('reason is required')
  })

  it('leaves the editor once the reason is non-empty', () => {
    let state = open('r')
    state = reducer(state, { type: 'commit-suppress-reason' })
    expect(state.suppress?.editingReason).toBe(false)
    expect(state.suppress?.error).toBeNull()
  })

  it('cycles the then-run toggle and comes back round', () => {
    let state = open('r')
    expect(state.suppress?.thenRun).toBe('resume')
    state = reducer(state, { type: 'cycle-then-run' })
    expect(state.suppress?.thenRun).toBe('gates')
    state = reducer(state, { type: 'cycle-then-run' })
    expect(state.suppress?.thenRun).toBe('none')
    state = reducer(state, { type: 'cycle-then-run' })
    expect(state.suppress?.thenRun).toBe('resume')
  })

  // Every one of those passing runs was recorded against the pre-write digest,
  // so `resume` would enqueue nothing — which is not an offer.
  it('starts the toggle on every gate when the resolved chain is empty', () => {
    let state = open('r')
    state = reducer(state, {
      type: 'suppress-preview',
      label: 'declawed/.skillspector-baseline.yaml',
      diff: '+ id: MP2',
      uncovered: [],
      stages: [],
    })
    expect(state.suppress?.thenRun).toBe('gates')

    let other = open('r')
    other = reducer(other, {
      type: 'suppress-preview',
      label: 'declawed/.skillspector-baseline.yaml',
      diff: '+ id: MP2',
      uncovered: ['skill-scanner'],
      stages: ['security'],
    })
    expect(other.suppress?.thenRun).toBe('resume')
    expect(other.suppress?.uncovered).toEqual(['skill-scanner'])
  })

  it('clears the slot on cancel', () => {
    const state = reducer(open('r'), { type: 'end-suppress' })
    expect(state.suppress).toBeNull()
  })

  it('ignores every suppression action when no slot is open', () => {
    const base = initialState([], 2)
    for (const action of [
      { type: 'commit-suppress-reason' },
      { type: 'cycle-then-run' },
      { type: 'scroll-suppress', delta: 1 },
      { type: 'suppress-error', message: 'x' },
    ] as const) {
      expect(reducer(base, action).suppress).toBeNull()
    }
  })
})
