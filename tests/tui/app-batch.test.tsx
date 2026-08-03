import { describe, expect, it, vi } from 'vitest'
import type { JobSpec, QueueHandle, SkillRef } from '../../src/core/index.js'
import { AsyncEventQueue } from '../../src/core/pipeline/queue.js'
import { App } from '../../src/tui/app.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeViews } from '../helpers/fake-views.js'

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

function recordingQueue(): { queue: QueueHandle; batches: JobSpec[][] } {
  const batches: JobSpec[][] = []
  const events = new AsyncEventQueue<never>()
  const queue: QueueHandle = {
    enqueue: (specs) => {
      batches.push([...specs])
      return specs.map((_spec, index) => `job-${batches.length}-${index}`)
    },
    snapshot: () => ({ concurrency: 2, queued: [], running: [], completed: [] }),
    cancelJob: vi.fn(async () => undefined),
    resolveMutation: vi.fn(),
    events: events as AsyncIterable<never>,
    idle: async () => undefined,
    close: () => events.close(),
  }
  return { queue, batches }
}

describe('batch enqueue — R5.5', () => {
  it('sends every marked skill and stage as one batch', async () => {
    const { queue, batches } = recordingQueue()
    const ui = renderInk(
      <App skills={SKILLS} queue={queue} stages={['security']} concurrency={2} views={fakeViews()} intervalMs={20} />,
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
