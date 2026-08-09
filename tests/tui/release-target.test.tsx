import { describe, expect, it } from 'vitest'
import type { QueueHandle, SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { initialState, reducer, type AppState } from '../../src/tui/store.js'
import { ReleaseTargetPane } from '../../src/tui/components/ReleaseTargetPane.js'
import { layoutFor } from '../../src/tui/layout.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeViews } from '../helpers/fake-views.js'
import { recordingQueue } from '../helpers/fake-run.js'
import { skillRef } from '../helpers/skill-ref.js'

const skill = (id: string, version: string | null = '1.0.1'): SkillRef =>
  skillRef(id, { version, isGit: true })

const SKILLS = [skill('declawed'), skill('spec-lint')]

const opened = (
  skillIds: readonly string[],
  refs: readonly SkillRef[],
  dirty: readonly string[] = [],
): AppState =>
  reducer(initialState(SKILLS, 2), {
    type: 'begin-release',
    skillIds,
    refs: Object.fromEntries(refs.map((ref) => [ref.id, ref])),
    dirty,
  })

const type = (state: AppState, text: string): AppState =>
  [...text].reduce(
    (acc, _char, index) => reducer(acc, { type: 'release-field', value: text.slice(0, index + 1) }),
    state,
  )

describe('R11.19 the release target slot', () => {
  it('starts empty rather than seeded, because R9.10 forbids inferring one', () => {
    const state = opened(['declawed'], [skill('declawed')])
    expect(state.release?.version).toBe('')
    expect(state.release?.resolved).toBeNull()
    expect(state.release?.field).toBe('version')
    expect(state.release?.allowDirty).toBe(false)
  })

  it('resolves a bump level against the freshly read frontmatter version', () => {
    const state = type(opened(['declawed'], [skill('declawed', '1.0.1')]), 'minor')
    expect(state.release?.resolved).toBe('1.1.0')
    expect(state.release?.error).toBeNull()
  })

  it('refuses a target that is not greater, before a job exists', () => {
    const state = type(opened(['declawed'], [skill('declawed', '1.1.0')]), '1.0.0')
    expect(state.release?.resolved).toBeNull()
    expect(state.release?.error).toMatch(/not greater than 1\.1\.0/)
  })

  it('refuses a value that is neither a semver nor a bump level', () => {
    const state = type(opened(['declawed'], [skill('declawed')]), 'next')
    expect(state.release?.error).toMatch(/not a semver or a bump level/)
  })

  it('refuses an explicit semver for a batch, and accepts a bump level', () => {
    const two = ['declawed', 'spec-lint']
    const refs = [skill('declawed', '1.0.1'), skill('spec-lint', '2.4.0')]

    const explicit = type(opened(two, refs), '3.0.0')
    expect(explicit.release?.error).toMatch(/one version cannot describe them all/)

    const bump = type(opened(two, refs), 'minor')
    expect(bump.release?.error).toBeNull()
    // Deliberately unresolved: the two skills bump to different numbers, so
    // naming one would name a version the other never gets.
    expect(bump.release?.resolved).toBeNull()
  })

  it('cycles the override stop only when there is something to override', () => {
    let clean = opened(['declawed'], [skill('declawed')])
    clean = reducer(clean, { type: 'cycle-release-field' })
    expect(clean.release?.field).toBe('notes')
    clean = reducer(clean, { type: 'cycle-release-field' })
    expect(clean.release?.field).toBe('version')
    // Nothing to override, so the flag cannot be raised either.
    expect(reducer(clean, { type: 'toggle-allow-dirty' }).release?.allowDirty).toBe(false)

    let dirty = opened(['declawed'], [skill('declawed')], ['declawed/.skillspector-baseline.yaml'])
    dirty = reducer(reducer(dirty, { type: 'cycle-release-field' }), {
      type: 'cycle-release-field',
    })
    expect(dirty.release?.field).toBe('dirty')
    expect(reducer(dirty, { type: 'toggle-allow-dirty' }).release?.allowDirty).toBe(true)
  })

  it('edits notes without touching the resolved version', () => {
    let state = type(opened(['declawed'], [skill('declawed', '1.0.1')]), 'patch')
    state = reducer(state, { type: 'cycle-release-field' })
    state = reducer(state, { type: 'release-field', value: 'tightened the register pass' })
    expect(state.release?.notes).toBe('tightened the register pass')
    expect(state.release?.version).toBe('patch')
    expect(state.release?.resolved).toBe('1.0.2')
  })
})

describe('R11.19 the release target pane', () => {
  const slot = (over: Partial<NonNullable<AppState['release']>> = {}) => ({
    ...(type(
      opened(['declawed'], [skill('declawed', '1.0.1')], ['declawed/.skillspector-baseline.yaml']),
      'minor',
    ).release as NonNullable<AppState['release']>),
    ...over,
  })

  it('names the current version, the resolution and the override', () => {
    const ui = renderInk(<ReleaseTargetPane release={slot()} layout={layoutFor(100, 30)} />, {
      columns: 100,
      rows: 30,
    })
    const frame = ui.lastFrame()
    expect(frame).toContain('current 1.0.1')
    expect(frame).toContain('minor → 1.1.0')
    expect(frame).toContain('[ ] override 1 uncommitted path(s)')
    expect(frame).toContain('declawed/.skillspector-baseline.yaml')
    ui.unmount()
  })

  it('marks the override once it is on', () => {
    const ui = renderInk(
      <ReleaseTargetPane release={slot({ allowDirty: true })} layout={layoutFor(100, 30)} />,
      { columns: 100, rows: 30 },
    )
    expect(ui.lastFrame()).toContain('[x] override')
    ui.unmount()
  })

  // §14.1's first rule. The uncommitted list is the only unbounded content, so
  // it is what gives way — the fields and the warning never do.
  it.each([
    [80, 24],
    [50, 14],
  ])('stays inside its allocation at %ix%i', (columns, rows) => {
    const many = Array.from({ length: 40 }, (_, i) => `declawed/file-${i}.md`)
    const ui = renderInk(
      <ReleaseTargetPane release={slot({ dirty: many })} layout={layoutFor(columns, rows)} />,
      { columns, rows },
    )
    const frame = ui.lastFrame()
    expect(frame.split('\n').length).toBeLessThanOrEqual(rows)
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(columns)
    // Truncated, and saying so — a list silently cut reads as a complete one.
    expect(frame).toMatch(/\+\d+ more/)
    ui.unmount()
  })
})

describe('R11.19 end to end through the Work screen', () => {
  const render = (queue: QueueHandle, views = fakeViews({}, SKILLS)) =>
    renderInk(
      <App
        skills={SKILLS}
        queue={queue}
        stages={['validate', 'evaluate', 'security']}
        concurrency={2}
        views={views}
        intervalMs={20}
      />,
      { columns: 100, rows: 30 },
    )

  const markRelease = async (ui: ReturnType<typeof render>): Promise<void> => {
    ui.stdin.send('\t') // focus the work zone
    await ui.settle()
    for (let i = 0; i < 4; i += 1) ui.stdin.send('l') // rail to Release
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
  }

  it('opens the pane instead of enqueuing a job with no target', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue)
    await ui.settle()
    await markRelease(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // The bug this closes: `r` used to enqueue here, and the run failed in 90ms
    // with "no target version supplied".
    expect(batches).toHaveLength(0)
    expect(ui.lastFrame()).toContain('Release — declawed')
    ui.unmount()
    queue.close()
  })

  it('enqueues the target the pane collected, on the freshly read ref', async () => {
    const { queue, batches } = recordingQueue()
    // The tree moved on since launch: `planRelease` is what sees it.
    const fresh = skill('declawed', '2.0.0')
    const ui = render(queue, fakeViews({ planRelease: async () => ({ skill: fresh, dirty: [] }) }))
    await ui.settle()
    await markRelease(ui)

    ui.stdin.send('r')
    await ui.settle(40)
    for (const char of 'minor') ui.stdin.send(char)
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(40)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]?.[0]?.stages).toEqual(['release'])
    expect(batches[0]?.[0]?.releaseTarget).toEqual({ version: 'minor' })
    // Not the launch-time 1.0.1: a bump computed from that would resolve to a
    // version the stage refuses as not greater.
    expect(batches[0]?.[0]?.skill.version).toBe('2.0.0')
    ui.unmount()
    queue.close()
  })

  it('carries the dirty override only once the user raises it', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(
      queue,
      fakeViews({
        planRelease: async () => ({
          skill: skill('declawed', '1.0.1'),
          dirty: ['declawed/.skillspector-baseline.yaml'],
        }),
      }),
    )
    await ui.settle()
    await markRelease(ui)

    ui.stdin.send('r')
    await ui.settle(40)
    for (const char of 'patch') ui.stdin.send(char)
    await ui.settle()
    ui.stdin.send('\t') // notes
    ui.stdin.send('\t') // override
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(40)

    expect(batches[0]?.[0]?.allowDirty).toBe(true)
    ui.unmount()
    queue.close()
  })

  it('refuses to enqueue while the target does not resolve', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue)
    await ui.settle()
    await markRelease(ui)

    ui.stdin.send('r')
    await ui.settle(40)
    // 1.0.0 against a current 1.0.1.
    for (const char of '1.0.0') ui.stdin.send(char)
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(40)

    expect(batches).toHaveLength(0)
    expect(ui.lastFrame()).toContain('not greater than 1.0.1')
    ui.unmount()
    queue.close()
  })

  it('leaves on escape with nothing enqueued', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue)
    await ui.settle()
    await markRelease(ui)

    ui.stdin.send('r')
    await ui.settle(40)
    ui.stdin.send('')
    await ui.settle()

    expect(batches).toHaveLength(0)
    expect(ui.lastFrame()).not.toContain('Release — declawed')
    ui.unmount()
    queue.close()
  })
})

describe('R11.20 the rail refuses a stage with nothing behind it', () => {
  it('names the stage rather than letting the mark land', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderInk(
      <App
        skills={SKILLS}
        queue={queue}
        stages={['validate', 'evaluate', 'security']}
        concurrency={2}
        views={fakeViews({}, SKILLS)}
        intervalMs={20}
      />,
      { columns: 100, rows: 30 },
    )
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    for (let i = 0; i < 3; i += 1) ui.stdin.send('l') // rail to Optimise
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()

    expect(ui.lastFrame()).toContain('optimise has no tool selected')
    expect(ui.lastFrame()).not.toContain('*Optimise')

    // And `r` therefore falls back to the configured stages rather than
    // enqueuing a run whose first stage cannot be planned.
    ui.stdin.send('r')
    await ui.settle(40)
    expect(batches[0]?.[0]?.stages).toEqual(['validate', 'evaluate', 'security'])
    ui.unmount()
    queue.close()
  })
})
