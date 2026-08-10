import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { SkillList } from '../../src/tui/components/SkillList.js'
import { initialState, reducer, repoGroups, repoSummary } from '../../src/tui/store.js'
import { fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

/** A terminal delivers an arrow as one three-byte CSI sequence in one read. */
const RIGHT = '\x1b[C'
const LEFT = '\x1b[D'

const inRepo = (id: string, repoId: string): SkillRef =>
  skillRef(id, { repo: { id: repoId, path: `/${repoId}`, name: repoId, isGit: false } })

/** Two repos, deliberately uneven, so a boundary is not the array's midpoint. */
const TWO_REPOS = [
  inRepo('declawed', 'zapac'),
  inRepo('gap-analysis', 'zapac'),
  inRepo('spec-lint', 'zapac'),
  inRepo('ui-lab', 'skills-lab'),
]

const ONE_REPO = [inRepo('declawed', 'zapac'), inRepo('spec-lint', 'zapac')]

function harness(skills: readonly SkillRef[]) {
  const queue = createQueue({
    concurrency: 2,
    startRun: (job) => fakeRun(`run-${job.skillId}`).handle,
  })
  const ui = renderInk(
    <App
      skills={skills}
      queue={queue}
      // R11.20 refuses a mark on a stage with no tool behind it, and the rail's
      // mark is this suite's observable for "the rail did not move".
      stages={['validate', 'evaluate', 'security']}
      concurrency={2}
      views={fakeViews()}
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )
  return { queue, ui }
}

describe('R11.23 repo groups', () => {
  it('groups the flat skill array into contiguous ranges, in walk order', () => {
    expect(repoGroups(TWO_REPOS)).toEqual([
      { repoId: 'zapac', label: 'zapac', start: 0, count: 3 },
      { repoId: 'skills-lab', label: 'skills-lab', start: 3, count: 1 },
    ])
    expect(repoGroups([])).toEqual([])
  })

  it('ranks running above every settled outcome, and reports the hidden mark', () => {
    const state = initialState(TWO_REPOS, 2)
    const zapac = state.repos[0]!
    const rows = state.skills.map((row, index) =>
      index === 0 ? { ...row, status: 'failed' as const } : row,
    )
    expect(repoSummary(rows, [], zapac)).toEqual({ status: 'failed', marked: false, count: 3 })

    const running = rows.map((row, index) =>
      index === 2 ? { ...row, status: 'running' as const } : row,
    )
    expect(repoSummary(running, [], zapac).status).toBe('running')
    // The one fact collapsing a repo costs the user.
    expect(repoSummary(rows, ['spec-lint'], zapac).marked).toBe(true)
    expect(repoSummary(rows, ['ui-lab'], zapac).marked).toBe(false)
  })
})

describe('R11.23 the entry level follows the repo count', () => {
  it('opens on the repos above one, and on the skills at one or none', () => {
    expect(initialState(TWO_REPOS, 2).listLevel).toBe('repos')
    expect(initialState(ONE_REPO, 2).listLevel).toBe('skills')
    expect(initialState([], 2).listLevel).toBe('skills')
  })

  it('names the level it is showing', async () => {
    const { ui, queue } = harness(TWO_REPOS)
    await ui.settle()
    expect(ui.lastFrame()).toContain('Repos')
    // The counts ride the hint, and the repo row carries how many it holds.
    // At the 22-cell column the whole 76–109 band uses, `skills-lab` is one
    // cell over its name column and elides, which is §14.1's second rule
    // working rather than a row to widen — the count is what must survive.
    expect(ui.lastFrame()).toMatch(/zapac\s+3/)
    expect(ui.lastFrame()).toMatch(/skills-lab\s+1|skills-la…\s+1/)
    // No skill is listed while the repo level is up.
    expect(ui.lastFrame()).not.toContain('gap-analysis')

    ui.stdin.send('l')
    await ui.settle()
    expect(ui.lastFrame()).toContain('zapac')
    expect(ui.lastFrame()).toContain('gap-analysis')
    expect(ui.lastFrame()).not.toContain('Repos')
    ui.unmount()
    queue.close()
  })

  it('opens straight on the skills when one repo is registered', async () => {
    const { ui, queue } = harness(ONE_REPO)
    await ui.settle()
    expect(ui.lastFrame()).not.toContain('Repos')
    expect(ui.lastFrame()).toMatch(/▸\s*[○◐●!×]\s*declawed/)
    ui.unmount()
    queue.close()
  })
})

describe('R11.23 the horizontal pair moves between the levels', () => {
  it('enters the selected repo and returns to it, under both letters and arrows', async () => {
    const { ui, queue } = harness(TWO_REPOS)
    await ui.settle()
    // Down to the second repo, in, and the level names it.
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send(RIGHT)
    await ui.settle()
    expect(ui.lastFrame()).toContain('ui-lab')
    expect(ui.lastFrame()).not.toContain('declawed')

    ui.stdin.send(LEFT)
    await ui.settle()
    expect(ui.lastFrame()).toContain('Repos')
    ui.unmount()
    queue.close()
  })

  it('lands on the repo holding the selected skill, not on the first', () => {
    let state = initialState(TWO_REPOS, 2)
    state = reducer(state, { type: 'select-repo', delta: 1 })
    state = reducer(state, { type: 'enter-repo' })
    expect(state.selectedSkill).toBe(3)

    // Back out from a skill in the second repo, and the cursor is on it.
    state = reducer(state, { type: 'leave-repo' })
    expect(state.selectedRepo).toBe(1)

    // And a round trip that never leaves the repo keeps the skill it was on.
    state = reducer(state, { type: 'enter-repo' })
    expect(state.selectedSkill).toBe(3)
  })

  it('reaches the repo level with only one repo registered', async () => {
    const { ui, queue } = harness(ONE_REPO)
    await ui.settle()
    expect(ui.lastFrame()).not.toContain('Repos')
    ui.stdin.send('h')
    await ui.settle()
    // A single repo means you do not start on the level, not that `h` means
    // something else there.
    expect(ui.lastFrame()).toContain('Repos')
    expect(ui.lastFrame()).toMatch(/zapac\s+2/)
    ui.unmount()
    queue.close()
  })

  it('leaves the rail alone from the skills zone, at either level', async () => {
    const { ui, queue } = harness(TWO_REPOS)
    await ui.settle()
    ui.stdin.send(RIGHT)
    await ui.settle()
    ui.stdin.send(RIGHT)
    await ui.settle()
    // Into the work zone, and mark whatever the rail is on.
    ui.stdin.send('\t')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('*Validate')
    expect(ui.lastFrame()).not.toContain('*Evaluate')
    ui.unmount()
    queue.close()
  })
})

describe('R11.23 the vertical pair stays inside the showing repo', () => {
  it('does not cross a repo boundary', () => {
    let state = initialState(TWO_REPOS, 2)
    state = reducer(state, { type: 'enter-repo' })
    expect(state.selectedSkill).toBe(0)
    for (let press = 0; press < 5; press += 1) {
      state = reducer(state, { type: 'select-skill', delta: 1 })
    }
    // zapac holds three, so the cursor stops on its last rather than walking
    // into skills-lab's first.
    expect(state.selectedSkill).toBe(2)

    state = reducer(state, { type: 'leave-repo' })
    state = reducer(state, { type: 'select-repo', delta: 1 })
    state = reducer(state, { type: 'enter-repo' })
    expect(state.selectedSkill).toBe(3)
    state = reducer(state, { type: 'select-skill', delta: -1 })
    expect(state.selectedSkill).toBe(3)
  })

  it('moves over the whole array when one repo holds everything', () => {
    let state = initialState(ONE_REPO, 2)
    state = reducer(state, { type: 'select-skill', delta: 1 })
    expect(state.selectedSkill).toBe(1)
    state = reducer(state, { type: 'select-skill', delta: 1 })
    expect(state.selectedSkill).toBe(1)
  })
})

describe('R11.23 the repo cursor is a chooser', () => {
  it('moves no skill selection, so the rail and the pane do not redraw', () => {
    let state = initialState(TWO_REPOS, 2)
    state = reducer(state, { type: 'select-repo', delta: 1 })
    expect(state.selectedRepo).toBe(1)
    expect(state.selectedSkill).toBe(0)
    expect(state.outputOffset).toBeNull()
  })

  it('refuses the mark key and names the level where it means something', async () => {
    const { ui, queue } = harness(TWO_REPOS)
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    expect(ui.lastFrame()).toContain('l enters the repo')
    // Nothing was marked: the title's hint would carry the count.
    expect(ui.lastFrame()).not.toContain('marked')
    ui.unmount()
    queue.close()
  })
})

describe('R11.23 costs no rows', () => {
  it('windows the repo level against its allocation and reports the overflow', async () => {
    // Six repos into three rows. The overflow count rides the title for the
    // reason the skill level's does: a panel one row taller than its budget
    // pushes the one below it off the bottom (§14.1).
    const many = ['a-repo', 'b-repo', 'c-repo', 'd-repo', 'e-repo', 'f-repo'].map((id) =>
      inRepo(`${id}-skill`, id),
    )
    const state = initialState(many, 2)
    const ui = renderInk(
      <SkillList
        skills={state.skills}
        selected={0}
        marked={[]}
        focused
        level="repos"
        repos={state.repos}
        selectedRepo={0}
        // Wide enough that the title holds the whole hint: at the 22-cell
        // column `Panel` elides it, and the claim here is about the window
        // rather than about what a narrow heading can say.
        width={40}
        height={3}
      />,
      { columns: 60, rows: 20 },
    )
    await ui.settle()
    const frame = ui.lastFrame() ?? ''
    expect(frame).toContain('+3 more')
    expect(frame.split('\n').filter((line) => line.includes('-repo'))).toHaveLength(3)
    ui.unmount()
  })

  it('renders inside the terminal at both floors, on either level', async () => {
    for (const [columns, rows] of [
      [80, 24],
      [50, 14],
    ] as const) {
      const queue = createQueue({
        concurrency: 2,
        startRun: (job) => fakeRun(`run-${job.skillId}`).handle,
      })
      const ui = renderInk(
        <App
          skills={TWO_REPOS}
          queue={queue}
          stages={['validate', 'evaluate', 'security']}
          concurrency={2}
          views={fakeViews()}
          intervalMs={20}
        />,
        { columns, rows },
      )
      await ui.settle()
      const atRepos = (ui.lastFrame() ?? '').split('\n')
      expect(atRepos.length).toBeLessThanOrEqual(rows)

      ui.stdin.send('l')
      await ui.settle()
      const atSkills = (ui.lastFrame() ?? '').split('\n')
      expect(atSkills.length).toBeLessThanOrEqual(rows)
      // A level that renders taller than the one beside it is a level that
      // pushes the panel below it off the bottom — §14.1's first rule, stated
      // as the thing the frame can actually answer. Neither list pads itself to
      // its allocation, which is why this is an inequality and not equality.
      expect(atRepos.length).toBeLessThanOrEqual(atSkills.length)
      ui.unmount()
      queue.close()
    }
  })
})
