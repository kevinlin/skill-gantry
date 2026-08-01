/** Design §14. Both are the acceptance numbers for R11.4. */
export const LOG_CAPACITY = 2000
export const FLUSH_INTERVAL_MS = 100

/**
 * Fixed-size, allocation-free once full. A shifting array would move every
 * element on every line, which is exactly the cost the buffer exists to avoid.
 */
export class RingBuffer {
  readonly #items: string[]
  #start = 0
  #count = 0
  #dropped = 0

  constructor(readonly capacity: number) {
    this.#items = new Array<string>(capacity)
  }

  get size(): number {
    return this.#count
  }

  /** Lines discarded since the buffer was created. The full log is on disk. */
  get dropped(): number {
    return this.#dropped
  }

  push(line: string): void {
    this.#items[(this.#start + this.#count) % this.capacity] = line
    if (this.#count < this.capacity) {
      this.#count += 1
    } else {
      this.#start = (this.#start + 1) % this.capacity
      this.#dropped += 1
    }
  }

  /** The newest `limit` lines, oldest first. */
  snapshot(limit = this.#count): string[] {
    const take = Math.min(limit, this.#count)
    const out: string[] = new Array<string>(take)
    const from = this.#count - take
    for (let i = 0; i < take; i += 1) {
      out[i] = this.#items[(this.#start + from + i) % this.capacity] as string
    }
    return out
  }
}

export interface LogPumpOptions {
  capacity?: number
  intervalMs?: number
  onFlush: (lines: readonly string[], dropped: number) => void
}

/**
 * Sits between the event stream and React. Chunks land in a ring buffer held
 * outside the component tree; a fixed tick copies the window into state, and
 * only when something arrived. This is the whole of R11.4.
 */
export class LogPump {
  readonly #buffer: RingBuffer
  readonly #intervalMs: number
  readonly #onFlush: LogPumpOptions['onFlush']
  /** Per source, because a chunk can end mid-line and two tools interleave. */
  readonly #carry = new Map<string, string>()
  #timer: NodeJS.Timeout | null = null
  #dirty = false

  constructor(options: LogPumpOptions) {
    this.#buffer = new RingBuffer(options.capacity ?? LOG_CAPACITY)
    this.#intervalMs = options.intervalMs ?? FLUSH_INTERVAL_MS
    this.#onFlush = options.onFlush
  }

  write(source: string, chunk: string): void {
    const pending = `${this.#carry.get(source) ?? ''}${chunk}`
    const parts = pending.split('\n')
    this.#carry.set(source, parts.pop() ?? '')
    for (const line of parts) {
      this.#buffer.push(`${source} │ ${line}`)
      this.#dirty = true
    }
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => this.flush(), this.#intervalMs)
    this.#timer.unref?.()
  }

  flush(): void {
    if (!this.#dirty) return
    this.#dirty = false
    this.#onFlush(this.#buffer.snapshot(), this.#buffer.dropped)
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    // A trailing partial line is real output; the tool simply never ended it.
    for (const [source, rest] of this.#carry) {
      if (rest.length > 0) {
        this.#buffer.push(`${source} │ ${rest}`)
        this.#dirty = true
      }
    }
    this.#carry.clear()
    this.flush()
  }
}
