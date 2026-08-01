import { Transform, type TransformCallback } from 'node:stream'

export const REDACTED = '«redacted»'

/** Shorter values are too collision-prone to scrub safely. */
const MIN_SECRET_LENGTH = 8

export function usableSecrets(secrets: readonly string[]): string[] {
  return [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort(
    (a, b) => b.length - a.length,
  )
}

export function redactString(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of usableSecrets(secrets)) out = out.split(secret).join(REDACTED)
  return out
}

/**
 * Scrubs secrets from a stream on the write path. Holds back the last
 * `maxSecretLength - 1` characters so a value split across chunk boundaries is
 * still caught; the remainder is flushed when the stream ends.
 */
export class RedactionTransform extends Transform {
  readonly #secrets: string[]
  readonly #holdback: number
  #buffer = ''

  constructor(secrets: readonly string[]) {
    super({ decodeStrings: false, encoding: 'utf8' })
    this.#secrets = usableSecrets(secrets)
    const longest = this.#secrets.reduce((max, s) => Math.max(max, s.length), 0)
    this.#holdback = longest > 0 ? longest - 1 : 0
  }

  override _transform(chunk: unknown, _enc: BufferEncoding, done: TransformCallback): void {
    this.#buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    const scrubbed = redactString(this.#buffer, this.#secrets)
    const emitUpTo = Math.max(0, scrubbed.length - this.#holdback)
    this.push(scrubbed.slice(0, emitUpTo))
    this.#buffer = scrubbed.slice(emitUpTo)
    done()
  }

  override _flush(done: TransformCallback): void {
    if (this.#buffer.length > 0) this.push(redactString(this.#buffer, this.#secrets))
    this.#buffer = ''
    done()
  }
}
