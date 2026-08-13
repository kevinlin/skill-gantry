import { describe, expect, it } from 'vitest'
import type { QueueEvent, SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeQueue } from '../helpers/fake-run.js'
import { emptySettings, fakeSetupDriver, fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const VIEW = { ...emptySettings, configPath: '/h/config.json' }

/** One character at a time, the way a terminal delivers them. */
async function type(
  ui: { stdin: { send: (s: string) => void }; settle: () => Promise<void> },
  keys: string,
): Promise<void> {
  for (const key of keys) ui.stdin.send(key)
  await ui.settle()
}

/** Mounts the app on its landing screen, which is Work. */
function mountApp(views = fakeViews({ settings: async () => VIEW }), setup = fakeSetupDriver()) {
  const queue = fakeQueue()
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={2}
      views={views}
      setup={setup}
      intervalMs={20}
    />,
  )
  // The queue comes back so a test can push a mutation review in front of the
  // confirmation and assert which one wins.
  return Object.assign(ui, { queue })
}

/** Mounts the app, drives the palette to Settings, and returns the harness. */
async function settingsScreen(
  views = fakeViews({ settings: async () => VIEW }),
  setup = fakeSetupDriver(),
) {
  const ui = mountApp(views, setup)
  await ui.settle()
  await type(ui, ':settings\r')
  return ui
}

/**
 * The wizard's other entry: `:setup` is a screen, so the palette reaches it
 * from Work without Settings ever having been on screen. This is the walk that
 * staged nothing — the screen had no document to stage into and said
 * `Registered` anyway.
 */
async function wizardFromWork(
  views = fakeViews({ settings: async () => VIEW }),
  setup = fakeSetupDriver(),
) {
  const ui = mountApp(views, setup)
  await ui.settle()
  await type(ui, ':setup\r')
  return ui
}

/**
 * One key per settle, for the reason the tests below already document: the
 * wizard's handler judges a key against the render it was registered in.
 */
async function walkToRepoStep(ui: Awaited<ReturnType<typeof settingsScreen>>): Promise<void> {
  // The config is read when the screen opens, so the first step is behind one
  // async read on the entry that does not come from Settings.
  await ui.settle(60)
  await type(ui, '\r')
  await type(ui, '1')
  await type(ui, '\r')
  // The installs are async, and until they land the wizard is still on a step
  // where `q` is its own leave binding.
  await ui.settle(120)
  await type(ui, '\r')
}

describe('Settings editing', () => {
  it('stages an edit and writes nothing until apply', async () => {
    const applied: unknown[] = []
    const ui = await settingsScreen(
      fakeViews({
        settings: async () => VIEW,
        applyConfig: async (next) => {
          applied.push(next)
        },
      }),
    )

    await type(ui, 'e4\r')
    expect(ui.lastFrame()).toContain('1 staged')
    expect(applied).toEqual([])
    ui.unmount()
  })

  it('renders the staged value rather than the loaded one', async () => {
    const ui = await settingsScreen()
    await type(ui, 'e8\r')
    expect(ui.lastFrame()).toContain('concurrency 8')
    ui.unmount()
  })

  it('shows the schema rejection and stages nothing', async () => {
    const ui = await settingsScreen()
    await type(ui, 'e99\r')

    expect(ui.lastFrame()).toMatch(/concurrency/)
    expect(ui.lastFrame()).not.toContain('1 staged')
    ui.unmount()
  })
})

describe('the setup states as a screen', () => {
  it('opens the setup screen seeded with the current selection', async () => {
    const view = {
      ...VIEW,
      config: {
        ...VIEW.config,
        stageTools: { validate: ['skill-lint'], evaluate: [], security: [], optimise: [] },
      },
      lockedTools: ['skill-lint'],
    }
    const ui = await settingsScreen(fakeViews({ settings: async () => view }))

    // enter leaves the runtime probe for the tool list, which is where a
    // seeded selection is visible at all.
    await type(ui, ':setup\r')
    await type(ui, '\r')

    // Seeded, so the tool the config already names arrives marked rather than
    // rendering a configured machine as having nothing selected.
    expect(ui.lastFrame()).toMatch(/\*\s*skill-lint/)
    ui.unmount()
  })

  it('stages the selection the wizard produced without writing it', async () => {
    const applied: unknown[] = []
    const driver = fakeSetupDriver()
    const ui = await settingsScreen(
      fakeViews({
        settings: async () => VIEW,
        applyConfig: async (next) => void applied.push(next),
      }),
      driver,
    )

    await type(ui, ':setup\r')
    // 1 selects the minimal preset, enter advances through install to the repo step.
    await type(ui, '1\r\r')

    expect(applied).toEqual([])
    expect(driver.saved).toEqual([])
    ui.unmount()
  })

  // §14.2's precedence: the wizard's handler is the only one acting while it is
  // up. Both handlers are mounted, so before the guard was hoisted above them,
  // `q` reached the app's quit binding and took the staged configuration with it.
  it('leaves the wizard for Settings on q rather than quitting the session', async () => {
    const ui = await settingsScreen()
    await type(ui, ':setup\r')
    await type(ui, '\r')
    expect(ui.lastFrame()).toContain('Select tools')

    await type(ui, 'q')

    expect(ui.lastFrame()).toContain('concurrency')
    expect(ui.lastFrame()).not.toContain('Select tools')
    ui.unmount()
  })

  it('types a repo path containing q, b and p into the field', async () => {
    const ui = await settingsScreen()
    // One key per settle: the wizard's handler reads the state of the render it
    // was registered in, so keys arriving in one tick are all judged against the
    // step the first of them left.
    await type(ui, ':setup\r')
    await type(ui, '\r')
    await type(ui, '1')
    await type(ui, '\r')
    // The installs are async, and until they land the wizard is still on a step
    // where `q` is its own leave binding — so the field has to be on screen
    // before a path containing one is typed at it.
    await ui.settle(120)
    await type(ui, '\r')
    expect(ui.lastFrame()).toContain('Credentials and repo')

    await type(ui, '/tmp/qbp-skills')

    expect(ui.lastFrame()).toContain('/tmp/qbp-skills')
    ui.unmount()
  })

  // R3.12: the screen's list is the staged document, and its edit stages a
  // change row rather than writing — the whole point of §14.2's second caller.
  it('stages a repo path edit under the same id, writing nothing', async () => {
    const applied: unknown[] = []
    const view = {
      ...VIEW,
      config: {
        ...VIEW.config,
        repos: [{ id: 'demos', path: '/tmp/demos', name: 'demos', isGit: false }],
      },
    }
    const ui = await settingsScreen(
      fakeViews({
        settings: async () => view,
        applyConfig: async (next) => void applied.push(next),
      }),
    )

    await type(ui, ':setup\r')
    await type(ui, '\r')
    await type(ui, '1')
    await type(ui, '\r')
    await ui.settle(120)
    await type(ui, '\r')
    expect(ui.lastFrame()).toContain('Credentials and repo')
    // The list is on screen, and the cursor starts on the add slot.
    expect(ui.lastFrame()).toContain('demos')

    await type(ui, '[A') // onto demos, prefilling /tmp/demos
    await type(ui, '-moved')
    await type(ui, '\r')

    expect(applied).toEqual([])
    await type(ui, 'q') // the wizard's own leave binding, back to Settings
    await type(ui, 'c')

    // One change row under the id the repo already had — not a remove and an
    // add, which is what would orphan its recorded runs.
    expect(ui.lastFrame()).toContain('repos[demos]')
    expect(ui.lastFrame()).toContain('/tmp/demos-moved')
    expect(applied).toEqual([])
    ui.unmount()
  })
})

// The screen stages into `state.staged ?? state.settings?.config`, and only the
// Settings screen ever loaded `state.settings` — so the wizard the palette
// opened from Work staged into nothing, silently, and reported success.
describe('the setup screen opened from outside Settings', () => {
  it('stages the repo it was given', async () => {
    const applied: unknown[] = []
    const ui = await wizardFromWork(
      fakeViews({
        settings: async () => VIEW,
        applyConfig: async (next) => void applied.push(next),
      }),
    )
    await walkToRepoStep(ui)
    expect(ui.lastFrame()).toContain('Credentials and repo')

    await type(ui, '/tmp/new-skills')
    await type(ui, '\r')
    await type(ui, 'q') // the wizard's own leave binding, onto Settings
    await ui.settle(60)

    // The count is the wizard's whole result — the tool selection it staged on
    // the way through, plus the repo — so the repo row is what this asserts.
    expect(ui.lastFrame()).toContain('staged · c confirm')
    await type(ui, 'c')
    expect(ui.lastFrame()).toContain('repos[new-skills]')
    expect(ui.lastFrame()).toContain('/tmp/new-skills')
    expect(applied).toEqual([])
    ui.unmount()
  })

  it('reports the repo as staged rather than registered, having written nothing', async () => {
    const ui = await wizardFromWork()
    await walkToRepoStep(ui)
    await type(ui, '/tmp/new-skills')
    await type(ui, '\r')

    const frame = ui.lastFrame()
    expect(frame).toContain('Staged /tmp/new-skills.')
    // The keystroke that finishes the job, in the footer where the keys live —
    // the done line stays one row whatever the path's length.
    expect(frame).toContain('c apply the change set')
    expect(frame).not.toContain('Registered')
    ui.unmount()
  })

  // The footer names `c`, so `c` acts from the screen the footer is on. Named
  // and unhandled, it was a user pressing it, seeing nothing, and reporting
  // that the repo could not be saved.
  it('opens the change set on c, from the done screen the key is named on', async () => {
    const ui = await wizardFromWork()
    await walkToRepoStep(ui)
    await type(ui, '/tmp/new-skills')
    await type(ui, '\r')
    await type(ui, 'c')
    await ui.settle(60)

    expect(ui.lastFrame()).toContain('repos[new-skills]')
    expect(ui.lastFrame()).toContain('a apply · d discard')
    ui.unmount()
  })

  it('seeds the tool selection the config already holds', async () => {
    const view = {
      ...VIEW,
      config: {
        ...VIEW.config,
        stageTools: { validate: ['skill-lint'], evaluate: [], security: [], optimise: [] },
      },
      lockedTools: ['skill-lint'],
    }
    const ui = await wizardFromWork(fakeViews({ settings: async () => view }))
    // The seed is a lazy `useReducer` init and runs once: a wizard mounted
    // before the config arrived would render a configured machine as empty.
    await ui.settle(60)
    await type(ui, '\r')

    expect(ui.lastFrame()).toMatch(/\*\s*skill-lint/)
    ui.unmount()
  })
})

describe('quitting with a staged document', () => {
  it('refuses, and names where the change set is', async () => {
    const ui = await settingsScreen()
    await type(ui, 'e4\r')
    await type(ui, 'q')

    const exited = await Promise.race([
      ui.waitUntilExit().then(() => true),
      ui.settle(80).then(() => false),
    ])
    expect(exited).toBe(false)
    expect(ui.lastFrame()).toContain('1 staged')
    expect(ui.lastFrame()).toContain(':settings')
    ui.unmount()
  })

  it('quits once the change set is discarded', async () => {
    const ui = await settingsScreen()
    // One key per tick from `c` on: the confirm pane's handler reads the state
    // of the render it was registered in, so a `d` arriving with the `c` is
    // judged against a screen that has no pane open yet.
    await type(ui, 'e4\r')
    await type(ui, 'c')
    await type(ui, 'd')
    await type(ui, 'q')

    const exited = await Promise.race([
      ui.waitUntilExit().then(() => true),
      ui.settle(80).then(() => false),
    ])
    expect(exited).toBe(true)
    ui.unmount()
  })
})

describe('the confirmation pane', () => {
  it('renders one row per change, names the file and states the restart', async () => {
    const ui = await settingsScreen()
    await type(ui, 'e4\rc')

    const frame = ui.lastFrame()
    expect(frame).toContain('config.json')
    expect(frame).toContain('concurrency')
    expect(frame).toContain('2 → 4')
    expect(frame).toContain('next launch')
    expect(frame).toContain('a apply · d discard')
    ui.unmount()
  })

  it('applies once and leaves nothing staged', async () => {
    const applied: unknown[] = []
    const ui = await settingsScreen(
      fakeViews({
        settings: async () => VIEW,
        applyConfig: async (next) => void applied.push(next),
      }),
    )

    await type(ui, 'e4\rc')
    expect(applied).toEqual([])
    await type(ui, 'a')

    expect(applied).toHaveLength(1)
    expect(ui.lastFrame()).not.toContain('staged')
    ui.unmount()
  })

  it('discards a staged edit and applies nothing', async () => {
    const applied: unknown[] = []
    const ui = await settingsScreen(
      fakeViews({
        settings: async () => VIEW,
        applyConfig: async (next) => void applied.push(next),
      }),
    )

    await type(ui, 'e4\rcd')

    expect(applied).toEqual([])
    expect(ui.lastFrame()).not.toContain('staged')
    ui.unmount()
  })

  it('says what a repo removal does and does not delete', async () => {
    const view = {
      ...VIEW,
      repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true, skills: 20 }],
      config: {
        ...VIEW.config,
        repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true }],
      },
    }
    const ui = await settingsScreen(fakeViews({ settings: async () => view }))
    // The repo row is the first actionable row, so d stages its removal and c
    // confirms.
    await type(ui, 'dc')

    expect(ui.lastFrame()).toContain('repos[alpha]')
    // "Remove" over a path reads as a delete unless the pane says otherwise.
    expect(ui.lastFrame()).toContain('workspaces and recorded runs are kept')
    ui.unmount()
  })

  it('keeps the mutation review in front of the confirmation', async () => {
    // The review's `a` writes the user's repo; the config pane's writes
    // ~/.skillgantry/config.json. Precedence is ordered by what a keystroke costs.
    const ui = await settingsScreen()
    await type(ui, 'e4\rc')
    const pending: QueueEvent = {
      type: 'run:event',
      jobId: 'j1',
      event: {
        type: 'mutation:pending',
        runId: 'run-1',
        stage: 'release',
        requestId: 'req-1',
        diff: '--- a\n+++ b\n',
        scope: ['SKILL.md'],
      },
    }
    ui.queue.emit(pending)
    await ui.settle()

    expect(ui.lastFrame()).toContain('Review —')
    // Both panes footer the same three keys, so the discriminator is the title:
    // the config change set is not what those keys are acting on.
    expect(ui.lastFrame()).not.toContain('Confirm —')
    expect(ui.lastFrame()).not.toContain('concurrency')
    ui.unmount()
  })
})
