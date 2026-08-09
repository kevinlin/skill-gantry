import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { CHROME_ROWS, KEY_COLUMN, KEYS } from '../../src/tui/components/Help.js'
import { innerWidth, layoutFor } from '../../src/tui/layout.js'
import { PANELS } from '../../src/tui/store.js'

/**
 * There was no test over `KEYS` as data, which is how it came to advertise
 * `1 – 4` for four tabs after M7 made `PANELS` five, and to omit `0`, `S` and
 * `s` entirely. A frame assertion cannot catch that: the list renders fine
 * whatever it says.
 */
describe('the help screen binding list', () => {
  it('fits an 80x24 terminal without cutting a row', () => {
    const layout = layoutFor(80, 24)
    expect(KEYS.length).toBeLessThanOrEqual(layout.rows - CHROME_ROWS[layout.chrome])
  })

  it('leaves every description room beside the key column at the 80-column floor', () => {
    const cols = innerWidth(80, layoutFor(80, 24).chrome)
    for (const [key, what] of KEYS) {
      expect(stringWidth(key)).toBeLessThanOrEqual(KEY_COLUMN)
      expect(stringWidth(what)).toBeLessThanOrEqual(cols - KEY_COLUMN)
    }
  })

  it('names as many output tabs as PANELS has', () => {
    const tabs = KEYS.find(([key]) => key.startsWith('1 –'))
    expect(tabs?.[0]).toBe(`1 – ${PANELS.length}`)
  })

  // The four the list omitted, and the two this extension adds. Named
  // individually rather than counted, so a row deleted to make budget fails
  // here rather than quietly reducing what the screen teaches.
  it.each([['0'], ['enter'], ['s / S'], ['h / l, ← / →']])('advertises %s', (key) => {
    expect(KEYS.map(([binding]) => binding)).toContain(key)
  })

  it('keeps the globals first, so an overflow cuts the screen-specific rows', () => {
    expect(KEYS.slice(0, 4).map(([key]) => key)).toEqual(['j / k, ↓ / ↑', ':', 'esc', '? / q'])
  })
})
