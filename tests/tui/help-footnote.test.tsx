import { describe, expect, it } from 'vitest'
import { Help, KEYS } from '../../src/tui/components/Help.js'
import { layoutFor } from '../../src/tui/layout.js'
import { renderInk } from '../helpers/render-ink.js'

function helpAt(columns: number, rows: number): string {
  const ui = renderInk(<Help layout={layoutFor(columns, rows)} />, { columns, rows })
  const frame = ui.lastFrame()
  ui.unmount()
  return frame
}

describe('R11.25 the help screen names the stale mark', () => {
  it('says what `~` before a verdict means, at the 80x24 floor, whole', () => {
    const frame = helpAt(80, 24)
    const line = frame.split('\n').find((row) => row.includes('~')) as string
    expect(line).toBeDefined()
    expect(line).toContain('other bytes')
    // Whole, not cut to `…`: a legend that is truncated is a mark with no key.
    expect(line).not.toContain('…')
  })

  it('keeps the first sentence it already taught', () => {
    expect(helpAt(100, 30)).toContain('Marking nothing runs every stage')
  })

  it('spends no row on it: the legend takes the footnote’s row and every binding stays on screen', () => {
    const frame = helpAt(80, 24)
    expect(frame.split('\n').length).toBeLessThanOrEqual(24)
    for (const [key] of KEYS) expect(frame).toContain(key.split(',')[0] as string)
  })

  it('draws exactly one footnote row, so the legend did not become a second line', () => {
    const frame = helpAt(80, 24)
    const body = frame.split('\n').filter((row) => row.trim() !== '')
    // The top border (carrying the title), one row per binding, the footnote,
    // and the bottom border. `KEYS` is at the 80x24 budget already, so a second
    // footnote row would be the one that pushes a binding off the screen.
    expect(body).toHaveLength(KEYS.length + 3)
  })
})
