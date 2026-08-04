import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
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

/** Mounts the app, drives the palette to Settings, and returns the harness. */
async function settingsScreen(
  views = fakeViews({ settings: async () => VIEW }),
  setup = fakeSetupDriver(),
) {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
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
  await ui.settle()
  await type(ui, ':settings\r')
  return ui
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
})
