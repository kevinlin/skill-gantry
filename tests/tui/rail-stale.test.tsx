import { describe, expect, it, vi } from 'vitest'

// The CI shell and a developer's differ on whether chalk colours at all, and the
// dim attribute is the half of R11.25's mark that only exists as an escape code.
// Chalk reads the environment when it is first imported, so this runs before the
// imports below do.
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1'
  delete process.env.NO_COLOR
})

import { STAGE_ORDER, type Stage } from '../../src/core/index.js'
import { LifecycleRail } from '../../src/tui/components/LifecycleRail.js'
import type { SkillRow, StageCell } from '../../src/tui/store.js'
import { renderInk } from '../helpers/render-ink.js'

const cell = (patch: Partial<StageCell> = {}): StageCell => ({
  outcome: null,
  running: false,
  summary: '',
  findings: 0,
  startedAt: null,
  ...patch,
})

const row = (stages: Partial<Record<Stage, StageCell>>): SkillRow => ({
  skillId: 'declawed',
  label: 'declawed',
  dir: '/repo/declawed',
  workspacePath: '/repo/declawed-workspace',
  status: 'idle',
  activeRunId: null,
  runId: null,
  runDir: null,
  stages: Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, stages[stage] ?? cell()]),
  ) as Record<Stage, StageCell>,
  findings: [],
  rehydrated: false,
  recordedLog: { lines: [], dropped: 0 },
})

const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 130, rows: 40 },
] as const
const MODES = ['full', 'short'] as const

function rawFrame(
  skill: SkillRow,
  labels: (typeof MODES)[number],
  size: (typeof SIZES)[number],
): string {
  const ui = renderInk(
    <LifecycleRail skill={skill} selected={0} marked={[]} focused={false} labels={labels} />,
    size,
  )
  const frame = ui.lastFrame()
  ui.unmount()
  return frame
}

const plain = (frame: string): string => frame.replace(/\x1b\[[0-9;]*m/g, '')

const DIM = '\x1b[2m'
const DIM_OFF = '\x1b[22m'

/** Whether `word` is drawn inside a dim span: the last attribute before it turns dim on. */
function isDim(frame: string, word: string): boolean {
  const at = frame.indexOf(word)
  if (at === -1) throw new Error(`${word} is not in the frame`)
  const before = frame.slice(0, at)
  return before.lastIndexOf(DIM) > before.lastIndexOf(DIM_OFF)
}

const stale = (outcome: StageCell['outcome']): StageCell => cell({ outcome, current: false, filledFrom: 'r' })
const fresh = (outcome: StageCell['outcome']): StageCell => cell({ outcome, current: true, filledFrom: 'r' })

describe('R11.25 the rail marks a verdict recorded against other bytes', () => {
  it('puts `~` in the cell’s leading space and the word after it, in both vocabularies', () => {
    const skill = row({ validate: stale('passed'), evaluate: stale('failed'), security: stale('degraded') })
    const full = plain(rawFrame(skill, 'full', SIZES[0]))
    expect(full).toContain('~passed')
    expect(full).toContain('~failed')
    expect(full).toContain('~degraded')
    const short = plain(rawFrame(skill, 'short', SIZES[0]))
    expect(short).toContain('~pass')
    expect(short).toContain('~FAIL')
    expect(short).toContain('~degr')
  })

  it('draws the word dim, and draws a current verdict as it always was', () => {
    const frame = rawFrame(row({ validate: fresh('passed'), evaluate: stale('passed') }), 'full', SIZES[0])
    expect(isDim(frame, '~passed')).toBe(true)
    // The first `passed` in the frame is validate's, which is current.
    expect(isDim(frame, ' passed')).toBe(false)
  })

  for (const size of SIZES) {
    for (const labels of MODES) {
      it(`moves no row or column at ${size.columns}x${size.rows} in the ${labels} band`, () => {
        // §14.1: the mark takes the space that was already there. Compared as
        // whole frames with the mark put back to a space, so any shifted cell,
        // gutter or border shows as a difference rather than hiding behind a
        // single offset check.
        const outcomes: Array<[Stage, StageCell['outcome']]> = [
          ['validate', 'passed'],
          ['evaluate', 'failed'],
          ['security', 'degraded'],
        ]
        const build = (make: typeof stale) =>
          row(Object.fromEntries(outcomes.map(([stage, outcome]) => [stage, make(outcome)])))
        const marked = plain(rawFrame(build(stale), labels, size))
        const unmarked = plain(rawFrame(build(fresh), labels, size))
        expect(marked).toContain('~')
        expect(marked.replaceAll('~', ' ')).toBe(unmarked)
        expect(marked.split('\n').map((line) => line.length)).toEqual(
          unmarked.split('\n').map((line) => line.length),
        )
      })
    }
  }

  it('leaves a cell no read has reached as it was: no mark until the ledger said so', () => {
    const frame = plain(rawFrame(row({ validate: cell({ outcome: 'passed' }) }), 'full', SIZES[0]))
    expect(frame).not.toContain('~')
    expect(frame).toContain(' passed')
  })

  it('never marks a stage in flight, whatever currency the cell last carried', () => {
    const frame = plain(
      rawFrame(row({ security: cell({ running: true, outcome: 'passed', current: false }) }), 'full', SIZES[0]),
    )
    expect(frame).not.toContain('~')
    expect(frame).toContain('running')
  })

  it('marks nothing on an empty cell', () => {
    expect(plain(rawFrame(row({ validate: cell({ current: false }) }), 'full', SIZES[0]))).not.toContain('~')
  })
})
