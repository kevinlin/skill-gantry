import { describe, expect, it } from 'vitest'
import type { QueueHandle, SkillRef } from '../../src/core/index.js'
import { App } from '../../src/tui/app.js'
import type { GantryViews } from '../../src/tui/views.js'
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

/** A skill with no `evals/eval.yaml`, which is the state R11.22 exists for. */
const noSuite = (): GantryViews =>
  fakeViews(
    {
      planEvals: async (skillId) => {
        const found = SKILLS.find((candidate) => candidate.id === skillId)
        if (found === undefined) throw new Error(`no skill ${skillId}`)
        return {
          skill: found,
          prompt: `# Author the eval suite for ${found.name}\n\n- Skill directory: \`${found.dir}\`\n`,
          hasSuite: false,
          missing: [],
        }
      },
    },
    SKILLS,
  )

const renderWith = (queue: QueueHandle, views: GantryViews) =>
  renderInk(
    <App
      skills={SKILLS}
      queue={queue}
      stages={['validate', 'evaluate', 'security']}
      concurrency={2}
      views={views}
      optimiseReady
      intervalMs={20}
    />,
    { columns: 100, rows: 30 },
  )

/** Focus the work zone, walk the rail to Evaluate, and mark it. */
const markEvaluate = async (ui: ReturnType<typeof renderWith>): Promise<void> => {
  ui.stdin.send('\t')
  await ui.settle()
  ui.stdin.send('l')
  await ui.settle()
  ui.stdin.send(' ')
  await ui.settle()
}

describe('R11.22 the eval bootstrap surface', () => {
  it('opens on a lone evaluate mark when the skill has no suite, and enqueues nothing', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderWith(queue, noSuite())
    await ui.settle()
    await markEvaluate(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // A run here reaches errored/missing-artefact and nothing else, which is
    // the outcome this surface exists to replace.
    expect(batches).toHaveLength(0)
    expect(ui.lastFrame()).toContain('Eval suite — ')
    expect(ui.lastFrame()).toContain('# Author the eval suite')
    ui.unmount()
    queue.close()
  })

  it('enqueues as before when the skill already carries a suite', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderWith(queue, fakeViews({}, SKILLS))
    await ui.settle()
    await markEvaluate(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // R5.5's batch shape, unchanged: the pre-flight is a branch, not a detour.
    expect(batches).toHaveLength(1)
    expect(batches[0]?.[0]?.stages).toEqual(['evaluate'])
    expect(ui.lastFrame()).not.toContain('Eval suite — ')
    ui.unmount()
    queue.close()
  })

  it('refuses a mixed mark by name rather than dropping either side', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderWith(queue, noSuite())
    await ui.settle()
    await markEvaluate(ui)
    ui.stdin.send('h') // back to validate
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()

    ui.stdin.send('r')
    await ui.settle(40)

    expect(ui.lastFrame()).toContain('has no eval suite')
    expect(ui.lastFrame()).toContain('unmark the others')
    expect(batches).toHaveLength(0)
    ui.unmount()
    queue.close()
  })

  it('enqueues a multi-skill batch without pre-checking it', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderWith(queue, noSuite())
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    ui.stdin.send('j')
    await ui.settle()
    ui.stdin.send(' ')
    await ui.settle()
    await markEvaluate(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // The known gap, deliberately: N port reads to build N prompts nobody
    // asked for is the wrong trade, and `:evals` is the recovery.
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    ui.unmount()
    queue.close()
  })

  it('clears the mark when the surface is cancelled', async () => {
    const { queue } = recordingQueue()
    const ui = renderWith(queue, noSuite())
    await ui.settle()
    await markEvaluate(ui)
    ui.stdin.send('r')
    await ui.settle(40)
    expect(ui.lastFrame()).toContain('# Author the eval suite')

    ui.stdin.send('') // esc
    await ui.settle(40)

    expect(ui.lastFrame()).not.toContain('# Author the eval suite')
    expect(ui.lastFrame()).not.toContain('1 marked')
    ui.unmount()
    queue.close()
  })

  it('opens from the palette whatever the suite state', async () => {
    const { queue, batches } = recordingQueue()
    // A suite is present, so `r` would enqueue — the palette entry is what
    // makes extending one reachable at all.
    const ui = renderWith(queue, fakeViews({}, SKILLS))
    await ui.settle()

    ui.stdin.send(':')
    await ui.settle()
    for (const ch of 'evals') ui.stdin.send(ch)
    await ui.settle()
    ui.stdin.send('\r')
    await ui.settle(40)

    expect(ui.lastFrame()).toContain('Eval suite — ')
    expect(batches).toHaveLength(0)
    ui.unmount()
    queue.close()
  })

  it('names the tool when skill-upper is unreachable, and enqueues nothing', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderWith(
      queue,
      fakeViews(
        {
          planEvals: async () => {
            throw new Error('skill-upper is not reachable — run `skillgantry setup`')
          },
        },
        SKILLS,
      ),
    )
    await ui.settle()
    await markEvaluate(ui)

    ui.stdin.send('r')
    await ui.settle(40)

    // A pre-flight that cannot answer must not silently enqueue a run the gate
    // cannot start, so the refusal names the tool and stops.
    expect(ui.lastFrame()).toContain('skill-upper is not reachable')
    expect(batches).toHaveLength(0)
    ui.unmount()
    queue.close()
  })
})

describe('the shared pane renders inside its allocation', () => {
  // §14.1's whole budget: one component for two kinds means one frame to
  // assert, which is the point of sharing it.
  for (const [columns, rows] of [
    [80, 24],
    [50, 14],
  ] as const) {
    for (const kind of ['optimise', 'evals'] as const) {
      it(`fits ${kind} at ${columns}x${rows}`, async () => {
        const { queue } = recordingQueue()
        const views = kind === 'optimise' ? fakeViews({}, SKILLS) : noSuite()
        const ui = renderInk(
          <App
            skills={SKILLS}
            queue={queue}
            stages={['validate', 'evaluate', 'security']}
            concurrency={2}
            views={views}
            optimiseReady
            intervalMs={20}
          />,
          { columns, rows },
        )
        await ui.settle()
        ui.stdin.send('\t')
        await ui.settle()
        for (let i = 0; i < (kind === 'optimise' ? 3 : 1); i += 1) ui.stdin.send('l')
        await ui.settle()
        ui.stdin.send(' ')
        await ui.settle()
        ui.stdin.send('r')
        await ui.settle(40)

        const frame = ui.lastFrame() ?? ''
        expect(frame.split('\n').length).toBeLessThanOrEqual(rows)
        ui.unmount()
        queue.close()
      })
    }
  }
})
