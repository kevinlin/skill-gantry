import { describe, expect, it } from 'vitest'
import {
  SETUP_ORDER,
  canEnter,
  entryBlockedReason,
  initialSetupState,
  missingRuntimesFor,
  setupReducer,
  stageToolsFor,
} from '../../src/core/tools/setup.js'
import { SKILLHONE_TOOL_ID, expandPreset } from '../../src/core/tools/catalogue.js'
import type { RuntimeStatus } from '../../src/core/tools/runtimes.js'

const probed: RuntimeStatus[] = [
  { runtime: 'uv', present: true, version: '0.7.12', installCommand: 'x' },
  { runtime: 'npm', present: false, version: null, installCommand: 'y' },
]

describe('setup state machine', () => {
  it('orders the four states of R3.6', () => {
    expect(SETUP_ORDER).toEqual([
      'probe-runtimes',
      'select-tools',
      'install-and-verify',
      'credentials-and-repo',
      'done',
    ])
  })

  it('advances only once its state has what the next one needs', () => {
    let state = initialSetupState()
    expect(canEnter(state, 'select-tools')).toBe(false)
    state = setupReducer(state, { type: 'probed', runtimes: probed })
    expect(canEnter(state, 'select-tools')).toBe(true)
    expect(canEnter(state, 'install-and-verify')).toBe(false)
    state = setupReducer(state, { type: 'preset', name: 'minimal' })
    expect(canEnter(state, 'install-and-verify')).toBe(true)
  })

  // R3.6: doctor re-enters probe and install without the rest, and a user who
  // backs out of installing must be able to reselect.
  it('lets any state be re-entered once its prerequisite holds', () => {
    let state = initialSetupState()
    state = setupReducer(state, { type: 'probed', runtimes: probed })
    state = setupReducer(state, { type: 'preset', name: 'minimal' })
    state = setupReducer(state, { type: 'enter', state: 'install-and-verify' })
    state = setupReducer(state, { type: 'enter', state: 'select-tools' })
    expect(state.state).toBe('select-tools')
    expect(state.selected.length).toBeGreaterThan(0)
  })

  it('refuses to enter a state whose prerequisite is unmet', () => {
    const state = setupReducer(initialSetupState(), { type: 'enter', state: 'install-and-verify' })
    expect(state.state).toBe('probe-runtimes')
  })

  it('toggles a tool for per-stage choice — R3.8', () => {
    let state = setupReducer(initialSetupState(), { type: 'probed', runtimes: probed })
    state = setupReducer(state, { type: 'toggle', toolId: 'skillspector' })
    expect(state.selected).toContain('skillspector')
    state = setupReducer(state, { type: 'toggle', toolId: 'skillspector' })
    expect(state.selected).not.toContain('skillspector')
  })

  it('records install progress and failure per tool', () => {
    let state = setupReducer(initialSetupState(), { type: 'probed', runtimes: probed })
    state = setupReducer(state, { type: 'preset', name: 'minimal' })
    state = setupReducer(state, { type: 'installing', toolId: 'skillspector' })
    expect(state.installed.skillspector).toBe('installing')
    state = setupReducer(state, { type: 'installed', toolId: 'skillspector' })
    expect(state.installed.skillspector).toBe('ok')
    state = setupReducer(state, { type: 'install-failed', toolId: 'skill-up', error: 'boom' })
    expect(state.installed['skill-up']).toBe('failed')
    expect(state.errors['skill-up']).toBe('boom')
  })

  it('names the runtimes a selection needs but the host lacks — R3.7', () => {
    const missing = missingRuntimesFor(
      ['skillspector'],
      [{ runtime: 'uv', present: false, version: null, installCommand: 'curl … | sh' }],
    )
    expect(missing.map((r) => r.installCommand)).toEqual(['curl … | sh'])
  })
})

describe('stageToolsFor', () => {
  // AdapterStageExecutor.plan() throws on an id the registry does not hold, so
  // an installed tool with no parser must not reach stageTools. The runnable
  // predicate is injected, so this case tests the filter rather than which
  // tools happen to ship an adapter in the current milestone.
  it('writes only runnable tools into the selection', () => {
    const tools = stageToolsFor(['skillspector', 'skill-lint'], (id) => id === 'skillspector')
    expect(tools.security).toEqual(['skillspector'])
    expect(tools.validate).toEqual([])
  })

  it('never writes the release installer, which no stage selects', () => {
    const tools = stageToolsFor(['skills'], () => true)
    expect(Object.values(tools).flat()).not.toContain('skills')
  })

  it('offers SkillHone for install but never writes it into stageTools', () => {
    const selected = expandPreset('recommended').map((spec) => spec.id)
    expect(selected).toContain(SKILLHONE_TOOL_ID)
    // `AdapterStageExecutor.plan()` throws `unknown tool: <id>` on an id the
    // registry does not hold, which fails every run of that stage. `stage: null`
    // is what keeps it out — asserted with the permissive predicate, so the
    // guard holds even where the runnable filter would not have caught it.
    const stageTools = stageToolsFor(selected, () => true)
    expect(Object.values(stageTools).flat()).not.toContain(SKILLHONE_TOOL_ID)
  })
})

describe('initialSetupState seeding', () => {
  it('seeds the selection so a re-entered wizard shows the current toolchain', () => {
    const state = initialSetupState({ selected: ['skill-lint', 'skillspector'] })
    expect(state.selected).toEqual(['skill-lint', 'skillspector'])
    expect(state.state).toBe('probe-runtimes')
  })

  it('marks a seeded install as ok so re-entry does not reinstall it', () => {
    const state = initialSetupState({ selected: ['skill-lint'], installed: { 'skill-lint': 'ok' } })
    // R3.6's gate is "every selected tool has to install before this step"; a tool
    // already locked and verified satisfies it without a second install.
    expect(entryBlockedReason(state, 'credentials-and-repo')).toBeNull()
  })

  it('still starts empty when nothing is seeded', () => {
    expect(initialSetupState().selected).toEqual([])
  })
})
