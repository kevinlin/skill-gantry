import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/tui/app.js'
import { reducer, initialState } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'
import { fakeQueue } from '../helpers/fake-run.js'
import type { QueueEvent, SkillRef } from '../../src/core/index.js'

const skill = (id: string): SkillRef => ({
  id,
  name: id,
  version: '1.0.0',
  dir: `/repo/${id}`,
  relPath: id,
  repo: { id: 'repo', path: '/repo', name: 'repo', isGit: true },
  rootSkill: false,
  workspacePath: `/repo/${id}-workspace`,
  deprecated: false,
  supersededBy: null,
})

const DIFF = [
  'diff --git a/sk/SKILL.md b/sk/SKILL.md',
  '--- a/sk/SKILL.md',
  '+++ b/sk/SKILL.md',
  '@@ -1,3 +1,3 @@',
  '-  version: 1.0.0',
  '+  version: 1.1.0',
].join('\n')

const pendingEvent = (jobId: string): QueueEvent => ({
  type: 'run:event',
  jobId,
  event: {
    type: 'mutation:pending',
    runId: 'run-1',
    stage: 'release',
    requestId: 'req-1',
    diff: DIFF,
    scope: ['sk/SKILL.md', 'sk_1.1.0.zip'],
  },
})

describe('the review store', () => {
  it('holds a pending mutation and clears it on resolution', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, {
      type: 'queue-event',
      event: { type: 'run:event', jobId: 'j1', event: { type: 'run:start', runId: 'run-1', skillId: 'sk', stages: ['release'], runDir: '/d' } },
    })
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') })
    expect(state.pending).toMatchObject({ jobId: 'j1', requestId: 'req-1', stage: 'release' })

    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j1',
        event: { type: 'mutation:resolved', runId: 'run-1', stage: 'release', requestId: 'req-1', action: 'apply' },
      },
    })
    expect(state.pending).toBeNull()
  })

  it('scrolls the diff without leaving it', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') })
    state = reducer(state, { type: 'scroll-review', delta: 3 })
    expect(state.pending?.offset).toBe(3)
    state = reducer(state, { type: 'scroll-review', delta: -99 })
    expect(state.pending?.offset).toBe(0)
  })
})

describe('the review pane', () => {
  it('replaces the screen, shows the scope and the diff, and offers a and d', async () => {
    const queue = fakeQueue()
    const { frames, unmount } = renderInk(<App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    const frame = frames.at(-1) as string
    expect(frame).toContain('sk/SKILL.md')
    expect(frame).toContain('version: 1.1.0')
    expect(frame).toContain('a apply')
    expect(frame).toContain('d discard')
    unmount()
  })

  it('routes a on the keyboard to queue.resolveMutation', async () => {
    const queue = fakeQueue()
    const resolve = vi.spyOn(queue, 'resolveMutation')
    const { stdin, unmount } = renderInk(<App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    stdin.write('a')
    await new Promise((r) => setTimeout(r, 30))
    expect(resolve).toHaveBeenCalledWith('j1', 'req-1', 'apply')
    unmount()
  })

  it('swallows movement while the review is open, like help', async () => {
    const queue = fakeQueue()
    const { stdin, frames, unmount } = renderInk(<App skills={[skill('sk'), skill('other')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    stdin.write('j')
    await new Promise((r) => setTimeout(r, 30))
    // The selection must not move under a screen the user cannot see.
    expect(frames.at(-1)).toContain('sk/SKILL.md')
    unmount()
  })

  it('fits its row budget at 80x24 and 50x14, reporting what it cut', async () => {
    const queue = fakeQueue()
    for (const [columns, rows] of [[80, 24], [50, 14]] as const) {
      const { frames, unmount } = renderInk(
        <App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />,
        { columns, rows },
      )
      queue.emit({ ...pendingEvent('j1'), event: { ...(pendingEvent('j1') as { event: { type: string } }).event, diff: Array.from({ length: 200 }, (_, i) => `+line ${i}`).join('\n') } } as QueueEvent)
      await new Promise((r) => setTimeout(r, 30))
      const frame = frames.at(-1) as string
      expect(frame.split('\n').length).toBeLessThanOrEqual(rows)
      expect(frame).toContain('more')
      unmount()
    }
  })
})
