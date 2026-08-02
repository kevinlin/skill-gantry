import { EventEmitter } from 'node:events'
import type { ReactElement } from 'react'
import { render } from 'ink'

class FakeStdout extends EventEmitter {
  readonly frames: string[] = []
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super()
  }
  write(data: string): boolean {
    this.frames.push(data)
    return true
  }
}

/**
 * Ink 6 reads input through `readable` plus `read()` rather than `data`
 * events, so the fake has to behave like a paused stream with a queue: a
 * `data`-only fake delivers no keypresses at all.
 */
class FakeStdin extends EventEmitter {
  readonly isTTY = true
  readonly #pending: string[] = []

  setRawMode(): this {
    return this
  }
  setEncoding(): this {
    return this
  }
  resume(): this {
    return this
  }
  pause(): this {
    return this
  }
  ref(): void {}
  unref(): void {}

  read(): string | null {
    return this.#pending.shift() ?? null
  }

  unshift(data: string | Buffer): void {
    this.#pending.unshift(typeof data === 'string' ? data : data.toString('utf8'))
  }

  /** Delivers a keypress the way a terminal would. */
  send(data: string): void {
    this.#pending.push(data)
    this.emit('readable')
    this.emit('data', data)
  }
}

export interface InkHarness {
  frames: string[]
  lastFrame(): string
  stdin: FakeStdin
  unmount(): void
  /** Lets effects, timers and one render cycle settle. */
  settle(ms?: number): Promise<void>
}

/**
 * `debug: true` makes Ink write a complete frame per render instead of ANSI
 * deltas, so a frame is directly assertable.
 */
export function renderInk(
  node: ReactElement,
  { columns = 100, rows = 30 }: { columns?: number; rows?: number } = {},
): InkHarness {
  const stdout = new FakeStdout(columns, rows)
  const stdin = new FakeStdin()
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  return {
    frames: stdout.frames,
    lastFrame: () => stdout.frames.at(-1) ?? '',
    stdin,
    unmount: () => instance.unmount(),
    settle: (ms = 20) => new Promise<void>((r) => setTimeout(r, ms)),
  }
}
