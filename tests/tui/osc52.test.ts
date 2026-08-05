import { describe, expect, it } from 'vitest'
import { OSC52_MAX_BYTES, osc52 } from '../../src/tui/osc52.js'

describe('R11.9 the OSC 52 sequence', () => {
  it('is ESC ] 52 ; c ; <base64> BEL', () => {
    const seq = osc52('hello') as string
    expect(seq).toBe('\u001B]52;c;aGVsbG8=\u0007')
    expect(Buffer.from(seq.slice('\u001B]52;c;'.length, -1), 'base64').toString('utf8')).toBe(
      'hello',
    )
  })

  it('encodes UTF-8, so a non-ASCII finding message round-trips', () => {
    // `binary` would mangle this on the way out and the paste would carry the
    // damage rather than fail visibly.
    const text = 'Kontextfenster überfüllt — «redacted» ✓'
    const payload = (osc52(text) as string).slice('\u001B]52;c;'.length, -1)
    expect(Buffer.from(payload, 'base64').toString('utf8')).toBe(text)
  })

  it('returns null over the cap, so no caller can report a copy that did not happen', () => {
    // Base64 is 4 bytes per 3, so this clears the cap comfortably.
    expect(osc52('x'.repeat(OSC52_MAX_BYTES))).toBeNull()
    expect(osc52('x'.repeat(16))).not.toBeNull()
  })
})
