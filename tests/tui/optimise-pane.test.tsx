import { describe, expect, it } from 'vitest'
import type { QueueHandle, SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import { fakeViews } from '../helpers/fake-views.js'
import { recordingQueue } from '../helpers/fake-run.js'
import { renderInk } from '../helpers/render-ink.js'
import { skillRef } from '../helpers/skill-ref.js'

const skill = (id: string): SkillRef => skillRef(id, { version: '1.0.1', isGit: true })
const SKILLS = [skill('declawed'), skill('spec-lint')]

const render = (queue: QueueHandle, optimiseReady: boolean) =>
  renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      stages={['validate', 'evaluate', 'security']}
      concurrency={2}
      views={fakeViews({}, SKILLS)}
      optimiseReady={optimiseReady}
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )

/** Focus the work zone, walk the rail to Optimise, and mark it. */
const markOptimise = async (ui: ReturnType<typeof render>): Promise<void> => {
  ui.stdin.send('\t')
  await ui.settle()
  for (let i = 0; i < 3; i += 1) ui.stdin.send('l')
  await ui.settle()
  ui.stdin.send(' ')
  await ui.settle()
}

describe('R11.21 the optimise surface', () => {
  it('opens on r and enqueues nothing', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue, true)
    await ui.settle()
    await markOptimise(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // R6.12 forbids SkillGantry running the optimiser, so there is no job to
    // make: the pane is the whole action.
    expect(batches).toHaveLength(0)
    expect(ui.lastFrame()).toContain('Optimise — ')
    expect(ui.lastFrame()).toContain('# Optimise:')
    ui.unmount()
    queue.close()
  })

  it('refuses a mixed mark by name', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue, true)
    await ui.settle()
    await markOptimise(ui)
    ui.stdin.send('h') // back to security
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()

    ui.stdin.send('r')
    await ui.settle(40)

    // Both resolutions of a mixed mark lie about what the marks asked for —
    // the same refusal release carries, for the same reason.
    expect(ui.lastFrame()).toContain('optimise runs on its own')
    expect(batches).toHaveLength(0)
    ui.unmount()
    queue.close()
  })

  it('clears the mark when the surface is cancelled', async () => {
    const { queue } = recordingQueue()
    const ui = render(queue, true)
    await ui.settle()
    await markOptimise(ui)
    ui.stdin.send('r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('# Optimise:')

    ui.stdin.send('') // esc
    await ui.settle(40)

    // The release mark surviving esc is the bug runs 019fe5b6 and 019fe5bb
    // paid for; this surface must not reintroduce it.
    expect(ui.lastFrame()).not.toContain('# Optimise:')
    expect(ui.lastFrame()).not.toContain('1 marked')
    ui.unmount()
    queue.close()
  })

  it('refuses the mark when SkillHone is not installed', async () => {
    const { queue } = recordingQueue()
    const ui = render(queue, false)
    await ui.settle()
    await markOptimise(ui)

    // R11.20 as amended: the refusal names the tool and the way out.
    expect(ui.lastFrame()).toContain('skillhone not installed')
    expect(ui.lastFrame()).not.toContain('1 marked')
    ui.unmount()
    queue.close()
  })

  it('refuses a multi-skill batch by name', async () => {
    const { queue, batches } = recordingQueue()
    const ui = render(queue, true)
    await ui.settle()
    ui.stdin.send(' ') // mark the first skill
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send(' ') // and the second
    await ui.settle()
    await markOptimise(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // SkillHone's loop is per-skill by construction, so a prompt naming five
    // skills is five unrelated loops in one paste.
    expect(ui.lastFrame()).toContain('one skill at a time')
    expect(batches).toHaveLength(0)
    ui.unmount()
    queue.close()
  })
})
