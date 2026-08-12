import { describe, expect, it } from 'vitest'
import { createQueue, type QueueEvent, type SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeQueue, fakeRun } from '../helpers/fake-run.js'
import { fakeViews } from '../helpers/fake-views.js'
import { renderInk } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

/** What a terminal sends for the escape key. */
const ESC = ''

function harness() {
  const queue = createQueue({ concurrency: 1, startRun: () => fakeRun('r1').handle })
  const views = fakeViews()
  const ui = renderInk(
    <App
      skills={[] as SkillRef[]}
      queue={queue}
      stages={['security']}
      concurrency={1}
      views={views}
      intervalMs={20}
    />,
  )
  return { ui, views }
}

const openPalette = async (ui: ReturnType<typeof harness>['ui'], typed: string): Promise<void> => {
  await ui.settle()
  ui.stdin.send(':')
  for (const char of typed) ui.stdin.send(char)
  await ui.settle()
}

describe(': command palette', () => {
  it('opens on : and lists every screen', async () => {
    const { ui } = harness()
    await openPalette(ui, '')
    const frame = ui.lastFrame()
    for (const command of ['work', 'dashboard', 'issues', 'tools', 'settings']) {
      expect(frame).toContain(command)
    }
    ui.unmount()
  })

  it('runs the filtered command on enter', async () => {
    const { ui } = harness()
    await openPalette(ui, 'issues')
    ui.stdin.send('\r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('Issues')
    ui.unmount()
  })

  it('esc closes it without switching screen', async () => {
    const { ui } = harness()
    await openPalette(ui, 'dash')
    ui.stdin.send(ESC)
    await ui.settle()
    expect(ui.lastFrame()).toContain('Queue')
    ui.unmount()
  })

  it('esc on a screen other than Work returns to Work', async () => {
    const { ui } = harness()
    await openPalette(ui, 'tools')
    ui.stdin.send('\r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('Tools')
    ui.stdin.send(ESC)
    await ui.settle()
    expect(ui.lastFrame()).toContain('Queue')
    ui.unmount()
  })

  it('leaves a pending review on screen — the diff wins over every modal', async () => {
    const queue = fakeQueue()
    const skill = skillRef('sk', {
      repo: { id: 'repo', path: '/repo', name: 'repo', isGit: true },
    })
    const pending: QueueEvent = {
      type: 'run:event',
      jobId: 'j1',
      event: {
        type: 'mutation:pending',
        runId: 'run-1',
        stage: 'release',
        requestId: 'req-1',
        diff: ['--- a/sk/SKILL.md', '+++ b/sk/SKILL.md', '+  version: 1.1.0'].join('\n'),
        scope: ['sk/SKILL.md'],
      },
    }
    const ui = renderInk(
      <App
        skills={[skill]}
        queue={queue}
        stages={['release']}
        concurrency={1}
        views={fakeViews()}
        intervalMs={5}
      />,
    )
    queue.emit(pending)
    await ui.settle(40)
    ui.stdin.send(':')
    await ui.settle(40)
    const frame = ui.lastFrame()
    expect(frame).toContain('version: 1.1.0')
    expect(frame).toContain('a apply')
    ui.unmount()
  })
})
