import { describe, expect, it } from 'vitest'
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
  runDir: null,
  stages: Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, stages[stage] ?? cell()]),
  ) as Record<Stage, StageCell>,
  findings: [],
  rehydrated: false,
  recordedLog: { lines: [], dropped: 0 },
})

function frameOf(skill: SkillRow | undefined, labels: 'full' | 'short' = 'full'): string {
  const ui = renderInk(
    <LifecycleRail skill={skill} selected={0} marked={[]} focused={false} labels={labels} />,
    { columns: 80, rows: 10 },
  )
  const frame = ui.lastFrame()
  ui.unmount()
  return frame
}

describe('§14.4 the rail counts while a stage is in flight', () => {
  it('replaces the word with the mark and the elapsed', () => {
    const frame = frameOf(
      row({ security: cell({ running: true, startedAt: Date.now() - 114_000 }) }),
    )
    // `▶` is the queue's own running mark, so the state survives a monochrome
    // terminal once the word is gone — paired with a number that changes.
    expect(frame).toContain('▶ 1m 54s')
    expect(frame).not.toContain('running')
  })

  it('says `running` when the store never saw the stage start', () => {
    // A row rehydrated off disk is never `running`, so this is the live path's
    // own guard: without it the rail would count from zero.
    expect(frameOf(row({ security: cell({ running: true }) }))).toContain('running')
  })

  it('keeps the word in the short band, which has no room for a second format', () => {
    const frame = frameOf(
      row({ security: cell({ running: true, startedAt: Date.now() - 114_000 }) }),
      'short',
    )
    expect(frame).toContain('run')
    expect(frame).not.toContain('▶')
  })

  it('does not move the columns when a stage starts, settles or is untouched', () => {
    // Derived from the live statuses the width grew the moment the first
    // outcome landed — `·` is one cell, `degraded` is eight — so the whole rail
    // shifted sideways under the cursor mid-batch, and the counter would move
    // it again on every tick. The stage labels are the fixed thing to measure.
    const columnOf = (frame: string): number => frame.indexOf('Release')
    const untouched = columnOf(frameOf(row({})))
    expect(untouched).toBeGreaterThan(0)
    expect(
      columnOf(frameOf(row({ security: cell({ running: true, startedAt: Date.now() - 4000 }) }))),
    ).toBe(untouched)
    expect(columnOf(frameOf(row({ evaluate: cell({ outcome: 'degraded' }) })))).toBe(untouched)
    expect(columnOf(frameOf(undefined))).toBe(untouched)
  })
})
