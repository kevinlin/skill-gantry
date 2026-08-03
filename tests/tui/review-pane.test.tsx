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
    state = reducer(state, { type: 'scroll-review', delta: 3, viewport: 2 })
    expect(state.pending?.offset).toBe(3)
    state = reducer(state, { type: 'scroll-review', delta: -99, viewport: 2 })
    expect(state.pending?.offset).toBe(0)
  })

  it('clamps the offset to the last full window, so the pane never empties', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') }) // 6-line DIFF
    // Four visible rows: the furthest useful offset is 2, not 5. Clamping to
    // the last *line* left one diff row on screen at the bottom of a diff.
    state = reducer(state, { type: 'scroll-review', delta: 9999, viewport: 4 })
    expect(state.pending?.offset).toBe(2)
    // A viewport taller than the diff cannot scroll at all.
    state = reducer(state, { type: 'scroll-review', delta: 9999, viewport: 20 })
    expect(state.pending?.offset).toBe(0)
  })

  it('counts a displacing mutation:pending and resets the count when the slot empties', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') })
    expect(state.displacedReviews).toBe(0)
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j2',
        event: { type: 'mutation:pending', runId: 'run-2', stage: 'release', requestId: 'req-2', diff: 'x', scope: ['other'] },
      },
    })
    expect(state.displacedReviews).toBe(1)
    expect(state.pending).toMatchObject({ jobId: 'j2', requestId: 'req-2' })

    // And it resets when the slot empties: the count belongs to the review on
    // screen, not to the whole session.
    state = reducer(state, {
      type: 'queue-event',
      event: {
        type: 'run:event',
        jobId: 'j2',
        event: { type: 'mutation:resolved', runId: 'run-2', stage: 'release', requestId: 'req-2', action: 'apply' },
      },
    })
    expect(state.displacedReviews).toBe(0)
  })

  it('clears a pending review whose run ended, even without having seen run:start', () => {
    let state = initialState([skill('sk')], 2)
    state = reducer(state, { type: 'queue-event', event: pendingEvent('j1') })
    state = reducer(state, {
      type: 'queue-event',
      event: { type: 'run:event', jobId: 'j1', event: { type: 'run:error', runId: 'run-1', message: 'boom' } },
    })
    expect(state.pending).toBeNull()
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
    stdin.send('a')
    await new Promise((r) => setTimeout(r, 30))
    expect(resolve).toHaveBeenCalledWith('j1', 'req-1', 'apply')
    unmount()
  })

  it('ignores Ctrl+A and Alt+A, which ink normalises onto the bare letter', async () => {
    // `\x01` is Ctrl+A; ink reports it as `input === 'a'` with `key.ctrl` set,
    // and Alt+A arrives as `\x1ba` with the escape stripped. Ctrl+A is a reflex
    // keystroke and this is the one screen whose keypress writes to the repo.
    const queue = fakeQueue()
    const resolve = vi.spyOn(queue, 'resolveMutation')
    const { stdin, unmount } = renderInk(<App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    stdin.send('\x01')
    stdin.send('\x1ba')
    await new Promise((r) => setTimeout(r, 30))
    expect(resolve).not.toHaveBeenCalled()
    // The plain key still works, so this is a modifier guard and not a
    // disabled binding.
    stdin.send('a')
    await new Promise((r) => setTimeout(r, 30))
    expect(resolve).toHaveBeenCalledWith('j1', 'req-1', 'apply')
    unmount()
  })

  it('swallows movement while the review is open, like help', async () => {
    const queue = fakeQueue()
    const { stdin, frames, unmount } = renderInk(<App skills={[skill('sk'), skill('other')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />)
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    stdin.send('j')
    await new Promise((r) => setTimeout(r, 30))
    // The selection must not move under a screen the user cannot see.
    expect(frames.at(-1)).toContain('sk/SKILL.md')
    unmount()
  })

  it('moves the window on the first j press, rather than centring on the offset', async () => {
    const queue = fakeQueue()
    const { stdin, frames, unmount } = renderInk(
      <App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />,
      { columns: 80, rows: 24 },
    )
    const longDiff = Array.from({ length: 200 }, (_, i) => `+line ${i}`).join('\n')
    queue.emit({ ...pendingEvent('j1'), event: { ...(pendingEvent('j1') as { event: object }).event, diff: longDiff } } as QueueEvent)
    await new Promise((r) => setTimeout(r, 30))
    expect(frames.at(-1)).toContain('+line 0')

    stdin.send('j')
    await new Promise((r) => setTimeout(r, 30))
    // A centred window over a 200-line diff would still show `+line 0` for
    // several presses; a plain offset-as-start moves on the very first one.
    expect(frames.at(-1)).not.toContain('+line 0')
    expect(frames.at(-1)).toContain('+line 1')
    unmount()
  })

  it('shows the review pane over help, so a cannot authorise a diff the user cannot see', async () => {
    const queue = fakeQueue()
    const { stdin, frames, unmount } = renderInk(
      <App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />,
    )
    stdin.send('?')
    await new Promise((r) => setTimeout(r, 30))
    expect(frames.at(-1)).toContain('SkillGantry — keys')

    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    const frame = frames.at(-1) as string
    expect(frame).toContain('sk/SKILL.md')
    expect(frame).not.toContain('SkillGantry — keys')
    unmount()
  })

  it('shows the review pane even on a too-small terminal, rather than the size warning', async () => {
    const queue = fakeQueue()
    const { frames, unmount } = renderInk(
      <App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />,
      { columns: 40, rows: 10 },
    )
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    const frame = frames.at(-1) as string
    expect(frame).toContain('sk/SKILL.md')
    expect(frame).not.toContain('Terminal too small')
    unmount()
  })

  it('shows a displaced review as a visible count rather than silently dropping it', async () => {
    const queue = fakeQueue()
    const { frames, unmount } = renderInk(
      <App skills={[skill('sk')]} queue={queue} stages={['release']} concurrency={2} intervalMs={5} />,
    )
    queue.emit(pendingEvent('j1'))
    await new Promise((r) => setTimeout(r, 30))
    queue.emit({
      type: 'run:event',
      jobId: 'j2',
      event: { type: 'mutation:pending', runId: 'run-2', stage: 'release', requestId: 'req-2', diff: 'y', scope: ['other'] },
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(frames.at(-1)).toContain('+1 waiting')
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
      expect(frame).toContain('hidden')
      unmount()
    }
  })
})
