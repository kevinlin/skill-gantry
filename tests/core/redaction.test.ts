import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { RedactionTransform, redactString } from '../../src/core/runner/redaction.js'

const SECRET = 'sk-testtokenvalue000000000000000000'
/** Long enough to clear the collision floor that makes short values unsafe to scrub. */
const OTHER_SECRET = 'other-secret-0001'

const pipeChunks = async (chunks: string[], secrets: string[]): Promise<string> =>
  text(Readable.from(chunks).pipe(new RedactionTransform(secrets)))

describe('RedactionTransform', () => {
  it('passes text through untouched when there is no secret', async () => {
    expect(await pipeChunks(['hello ', 'world'], [SECRET])).toBe('hello world')
  })

  it('redacts a secret contained in one chunk', async () => {
    const out = await pipeChunks([`TOKEN=${SECRET}\n`], [SECRET])
    expect(out).not.toContain(SECRET)
    expect(out).toContain('«redacted»')
  })

  it('redacts a secret split across two chunks', async () => {
    const head = SECRET.slice(0, 10)
    const tail = SECRET.slice(10)
    const out = await pipeChunks([`TOKEN=${head}`, `${tail}\n`], [SECRET])
    expect(out).not.toContain(SECRET)
    expect(out).toContain('«redacted»')
  })

  it('redacts a secret split across three chunks', async () => {
    const out = await pipeChunks(
      [SECRET.slice(0, 5), SECRET.slice(5, 20), SECRET.slice(20)],
      [SECRET],
    )
    expect(out).toBe('«redacted»')
  })

  it('emits every byte when the stream ends mid-buffer', async () => {
    expect(await pipeChunks(['abc'], [SECRET])).toBe('abc')
  })

  it('handles many secrets and repeated occurrences', async () => {
    const out = await pipeChunks(
      [`${SECRET} and ${SECRET} and ${OTHER_SECRET}`],
      [SECRET, OTHER_SECRET],
    )
    expect(out).toBe('«redacted» and «redacted» and «redacted»')
  })

  it('ignores empty and very short secrets', async () => {
    expect(await pipeChunks(['a b c'], ['', 'a'])).toBe('a b c')
  })
})

describe('redactString', () => {
  it('scrubs every occurrence', () => {
    expect(redactString(`x ${SECRET} y`, [SECRET])).toBe('x «redacted» y')
  })
})
