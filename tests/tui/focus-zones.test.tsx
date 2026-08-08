import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { FOCUSES, reducer, initialState } from '../../src/tui/store.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
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
  deprecated: false,
  supersededBy: null,
})

const SKILLS = [skill('declawed'), skill('spec-lint')]

function harness() {
  const queue = createQueue({
    concurrency: 2,
    startRun: (job) => fakeRun(`run-${job.skillId}`).handle,
  })
  const ui = renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      stages={['security']}
      concurrency={2}
      views={fakeViews()}
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )
  return { queue, ui }
}

describe('R11.11 focus zones', () => {
  it('cycles exactly three zones, in the order they sit on the screen', () => {
    expect([...FOCUSES]).toEqual(['skills', 'work', 'queue'])
    let state = initialState(SKILLS, 2)
    expect(state.focus).toBe('skills')
    state = reducer(state, { type: 'cycle-focus', delta: 1 })
    expect(state.focus).toBe('work')
    state = reducer(state, { type: 'cycle-focus', delta: 1 })
    expect(state.focus).toBe('queue')
    state = reducer(state, { type: 'cycle-focus', delta: 1 })
    expect(state.focus).toBe('skills')
  })

  // The rail carries its selection in `underline` and `bold`, which a `debug`
  // frame writes as plain text — so the observable is the `*` the mark key puts
  // on whichever stage the rail had selected. Marking is how the frame answers
  // "where is the rail's cursor", which is the question these two cases ask.
  it('leaves the rail alone while the skill list has focus', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    // Validate is selected on entry. `l` must not move it from the skills zone.
    ui.stdin.send('l')
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('*Validate')
    expect(ui.lastFrame()).not.toContain('*Evaluate')
    ui.unmount()
    queue.close()
  })

  it('moves the rail once the work zone has focus', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send('l')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('*Evaluate')
    expect(ui.lastFrame()).not.toContain('*Validate')
    ui.unmount()
    queue.close()
  })

  it('marks a skill in the skills zone and a stage in the work zone', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    // The row's own mark, not the panel hint: a 22-cell list column truncates
    // `1/2 · 1 marked` mid-word, so the hint is the wrong thing to assert on.
    expect(ui.lastFrame()).toMatch(/\*\s*[○◐●!×]\s*declawed/)
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    // The rail marks its selected stage with `*`, and the skill mark stands.
    expect(ui.lastFrame()).toContain('*Validate')
    expect(ui.lastFrame()).toMatch(/\*\s*[○◐●!×]\s*declawed/)
    ui.unmount()
    queue.close()
  })

  it('cancels only from the queue zone, where the job cursor lives', async () => {
    const { ui, queue } = harness()
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)
    // `x` from the skills zone must not reach the job the queue zone owns.
    ui.stdin.send('x')
    await ui.settle(40)
    expect(ui.lastFrame()).not.toContain('cancelled')
    ui.unmount()
    queue.close()
  })
})
