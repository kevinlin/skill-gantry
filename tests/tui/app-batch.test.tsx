import { describe, expect, it } from 'vitest'
import { App } from '../../src/tui/app.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeViews } from '../helpers/fake-views.js'
import { recordingQueue } from '../helpers/fake-run.js'
import { skillRef } from '../helpers/skill-ref.js'

const SKILLS = [skillRef('declawed'), skillRef('spec-lint')]

describe('batch enqueue — R5.5', () => {
  it('sends every marked skill and stage as one batch', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderInk(
      // The stages this test marks have to be configured ones: R11.20 refuses a
      // mark on a stage with no tool behind it.
      <App
        skills={SKILLS}
        queue={queue}
        stages={['validate', 'evaluate', 'security']}
        concurrency={2}
        views={fakeViews()}
        intervalMs={20}
      />,
    )
    await ui.settle()

    ui.stdin.send(' ') // mark declawed
    await ui.settle()
    ui.stdin.send('j')
    ui.stdin.send(' ') // mark spec-lint
    await ui.settle()
    ui.stdin.send('\t') // focus stages
    await ui.settle()
    ui.stdin.send(' ') // mark validate
    await ui.settle()
    ui.stdin.send('l')
    ui.stdin.send(' ') // mark evaluate
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0]?.map((spec) => spec.skill.id).sort()).toEqual(['declawed', 'spec-lint'])
    expect(batches[0]?.[0]?.stages).toEqual(['validate', 'evaluate'])
    ui.unmount()
    queue.close()
  })

  it('falls back to the selected skill and the configured stages', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderInk(
      <App skills={SKILLS} queue={queue} stages={['security']} concurrency={2} views={fakeViews()} intervalMs={20} />,
    )
    await ui.settle()
    ui.stdin.send('r')
    await ui.settle(40)

    expect(batches).toEqual([[{ skill: SKILLS[0], stages: ['security'] }]])
    ui.unmount()
    queue.close()
  })
})
