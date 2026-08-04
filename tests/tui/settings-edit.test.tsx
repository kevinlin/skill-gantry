import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { emptySettings, fakeViews } from '../helpers/fake-views.js'
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
async function settingsScreen(views = fakeViews({ settings: async () => VIEW })) {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={2}
      views={views}
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
