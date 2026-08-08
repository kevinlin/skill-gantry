import { describe, expect, it } from 'vitest'
import { Text } from 'ink'
import { Panel } from '../../src/tui/components/Panel.js'
import { layoutFor } from '../../src/tui/layout.js'
import { renderInk } from '../helpers/render-ink.js'

function frame(node: React.ReactElement, columns = 40, rows = 10): string {
  const ui = renderInk(node, { columns, rows })
  const out = ui.lastFrame()
  ui.unmount()
  return out
}

describe('Panel titled border', () => {
  it('renders the title inside the top border, not as a body row', () => {
    const out = frame(
      <Panel title="Skills" hint="7/18" focused={false} chrome="boxed" width={40}>
        <Text>first</Text>
      </Panel>,
    )
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    // The title rides the border: same row as the corner glyphs.
    expect(lines[0]).toContain('Skills')
    expect(lines[0]).toContain('7/18')
    expect(lines[0]?.startsWith('┌')).toBe(true)
    expect(lines[0]).toContain('┐')
    // And the very next row is content, not a repeat of the heading.
    expect(lines[1]).toContain('first')
    expect(lines[1]).not.toContain('Skills')
  })

  it('matches the title row to the box beneath it exactly, so no corner tears', () => {
    const out = frame(
      <Panel title="Queue" hint="idle" focused chrome="boxed" width={40}>
        <Text>row</Text>
      </Panel>,
    )
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    const top = lines[0] as string
    const bottom = lines.at(-1) as string
    expect(top.length).toBe(bottom.length)
    expect(top.length).toBe(40)
  })

  it('keeps the title as a body row in bare chrome, which has no border to hold it', () => {
    const out = frame(
      <Panel title="Skills" focused={false} chrome="bare" width={40}>
        <Text>first</Text>
      </Panel>,
    )
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    expect(lines[0]).toContain('Skills')
    expect(lines[0]?.startsWith('┌')).toBe(false)
  })

  it('gives the saved row back to the layout budget', () => {
    // BOXED_CHROME 11 -> 10. Both Skills and Queue stopped spending a body row
    // on their heading, but only Queue's was on the frame's vertical path —
    // Skills sits beside the rail, so its row is left-column slack instead.
    expect(layoutFor(80, 24).outputHeight).toBe(12)
  })
})
