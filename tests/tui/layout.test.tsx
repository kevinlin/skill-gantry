import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { JobRecord, SkillRef } from '../../src/core/index.js'
import { Work } from '../../src/tui/components/Work.js'
import { MIN_COLUMNS, MIN_ROWS, layoutFor, truncate, windowFor } from '../../src/tui/layout.js'
import { initialState, type AppState } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'

function frameAt(node: ReactElement, columns: number, rows: number): string {
  const harness = renderInk(node, { columns, rows })
  const frame = harness.lastFrame()
  harness.unmount()
  return frame
}

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

const NAMES = [
  'declawed',
  'gap-analysis',
  'spec-lint',
  'zuhlke-slides-and-decks-generator',
  'rfp-daily',
  'agent-insights',
  'architecture-diagram',
]

function busyState(): AppState {
  const base = initialState(NAMES.map(skill), 2)
  const jobs: JobRecord[] = [
    { jobId: 'j1', skillId: 'declawed', stages: ['validate', 'security'], state: 'running' },
    { jobId: 'j2', skillId: 'spec-lint', stages: ['validate'], state: 'queued' },
    { jobId: 'j3', skillId: 'rfp-daily', stages: ['security'], state: 'queued' },
  ] as JobRecord[]
  return {
    ...base,
    jobs,
    log: {
      lines: Array.from({ length: 30 }, (_, i) => `skillspector: scanning declawed/scripts/f${i}.py`),
      dropped: 0,
    },
  }
}

/** The size the frame must never exceed, whatever the content. */
function measure(frame: string): { rows: number; columns: number } {
  const lines = frame.replace(/\n$/, '').split('\n')
  const bare = lines.map((line) => line.replace(/\[[0-9;]*m/g, ''))
  return { rows: bare.length, columns: Math.max(...bare.map((l) => [...l].length)) }
}

describe('layoutFor', () => {
  it('refuses to render below the floor rather than shredding the frame', () => {
    expect(layoutFor(MIN_COLUMNS - 1, 40).mode).toBe('too-small')
    expect(layoutFor(120, MIN_ROWS - 1).mode).toBe('too-small')
    expect(layoutFor(MIN_COLUMNS, MIN_ROWS).mode).not.toBe('too-small')
  })

  it('stacks the skill list above the rail below 76 columns', () => {
    expect(layoutFor(75, 30).skillListWidth).toBe(0)
    expect(layoutFor(76, 30).skillListWidth).toBeGreaterThan(0)
  })

  it('spends a wide terminal on the skill column, up to a cap', () => {
    expect(layoutFor(110, 30).skillListWidth).toBe(26)
    expect(layoutFor(160, 30).skillListWidth).toBe(28)
    // Past the cap the extra width goes to the pane, not to the list.
    expect(layoutFor(240, 30).skillListWidth).toBe(34)
    expect(layoutFor(400, 30).skillListWidth).toBe(34)
  })

  it('shortens stage labels only once the rail cannot hold full ones', () => {
    expect(layoutFor(120, 30).stageLabels).toBe('full')
    expect(layoutFor(80, 24).stageLabels).toBe('full')
    expect(layoutFor(52, 24).stageLabels).toBe('short')
  })

  it('grows the output pane with the terminal instead of pinning it at 12', () => {
    expect(layoutFor(120, 50).outputHeight).toBeGreaterThan(layoutFor(120, 24).outputHeight)
  })
})

describe('truncate', () => {
  it('reserves a cell for the ellipsis', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…')
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abc', 0)).toBe('')
  })

  it('measures cells, not code units, so a CJK name cannot overflow', () => {
    // Four ideographs are eight cells wide; .length would have called it four.
    expect([...truncate('日本語表示', 6)].length).toBeLessThanOrEqual(3)
    expect(truncate('日本語表示', 6).endsWith('…')).toBe(true)
  })
})

describe('windowFor', () => {
  it('keeps the selection inside the window', () => {
    for (const selected of [0, 5, 9, 19]) {
      const { start, end } = windowFor(20, selected, 6)
      expect(selected).toBeGreaterThanOrEqual(start)
      expect(selected).toBeLessThan(end)
      expect(end - start).toBe(6)
    }
  })

  it('shows everything when it fits', () => {
    expect(windowFor(3, 0, 10)).toEqual({ start: 0, end: 3 })
  })
})

describe('Work screen fits its terminal', () => {
  for (const [columns, rows] of [
    [200, 60],
    [120, 40],
    [100, 30],
    [80, 24],
    [60, 20],
    [50, 14],
  ] as const) {
    it(`fits ${columns}x${rows}`, () => {
      const size = measure(frameAt(<Work state={busyState()} />, columns, rows))
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })

    it(`fits the help screen at ${columns}x${rows}`, () => {
      const state = { ...busyState(), help: true }
      const size = measure(frameAt(<Work state={state} />, columns, rows))
      expect(size.rows).toBeLessThanOrEqual(rows)
      expect(size.columns).toBeLessThanOrEqual(columns)
    })
  }

  it('says so below the floor instead of rendering a broken frame', () => {
    const frame = frameAt(<Work state={busyState()} />, 40, 10)
    expect(frame).toContain('Terminal too small')
    expect(frame).toContain('50×14')
  })

  it('truncates a long skill name instead of spilling past the column', () => {
    const frame = frameAt(<Work state={busyState()} />, 100, 30)
    expect(frame).not.toContain('zuhlke-slides-and-decks-generator')
    expect(frame).toContain('…')
  })

  it('windows a skill list longer than its pane and says how many are hidden', () => {
    const state = { ...busyState(), skills: initialState(NAMES.map(skill), 2).skills }
    const frame = frameAt(<Work state={state} />, 80, 16)
    expect(frame).toMatch(/\+\d+ more/)
  })
})
