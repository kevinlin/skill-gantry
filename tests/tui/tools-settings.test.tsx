import { describe, expect, it } from 'vitest'
import { createQueue, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeRun } from '../helpers/fake-run.js'
import { emptyDoctor, emptySettings, fakeViews, toolFinding } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'

const REPORT = {
  ...emptyDoctor,
  runtimes: [
    { runtime: 'uv' as const, present: true, version: '0.7.12', installCommand: 'brew install uv' },
  ],
  tools: [toolFinding('skillspector', 'ok', '2.5.1')],
}

const VIEW = {
  ...emptySettings,
  concurrency: 3,
  repos: [{ id: 'alpha', name: 'alpha', path: '/alpha', isGit: true, skills: 20 }],
  credentials: [{ label: 'skillspector', satisfied: true, detail: 'no credential required' }],
}

async function screen(name: string, size = { columns: 100, rows: 30 }) {
  let toolsCalls = 0
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews({
    tools: async () => {
      toolsCalls += 1
      return REPORT
    },
    settings: async () => VIEW,
  })
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
    size,
  )
  await ui.settle()
  ui.stdin.send(':')
  for (const char of name) ui.stdin.send(char)
  ui.stdin.send('\r')
  await ui.settle(60)
  return { ui, calls: () => toolsCalls }
}

describe('Tools screen — R3.9 rendered', () => {
  it('lists runtimes and tools', async () => {
    const { ui } = await screen('tools')
    expect(ui.lastFrame()).toContain('Runtimes')
    expect(ui.lastFrame()).toContain('skillspector')
    ui.unmount()
  })

  it('r re-probes', async () => {
    const { ui, calls } = await screen('tools')
    const before = calls()
    ui.stdin.send('r')
    await ui.settle(60)
    expect(calls()).toBeGreaterThan(before)
    ui.unmount()
  })
})

describe('Settings screen', () => {
  it('shows repos, concurrency and credential status', async () => {
    const { ui } = await screen('settings')
    const frame = ui.lastFrame()
    expect(frame).toContain('/alpha')
    expect(frame).toContain('concurrency 3')
    expect(frame).toContain('skillspector')
    ui.unmount()
  })

  it('renders no credential value — R7.3 holds for a screen too', async () => {
    const { ui } = await screen('settings')
    expect(ui.lastFrame()).not.toMatch(/sk-[A-Za-z0-9]/)
    ui.unmount()
  })
})

describe('both screens fit a small terminal', () => {
  it('fits 80x24 and 50x14', async () => {
    for (const name of ['tools', 'settings']) {
      for (const size of [
        { columns: 80, rows: 24 },
        { columns: 50, rows: 14 },
      ]) {
        const { ui } = await screen(name, size)
        expect(ui.lastFrame().split('\n').length).toBeLessThanOrEqual(size.rows)
        ui.unmount()
      }
    }
  })
})
