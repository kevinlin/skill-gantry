import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogPump, RingBuffer } from '../../src/tui/log-buffer.js'

describe('RingBuffer', () => {
  it('keeps the newest lines in order', () => {
    const ring = new RingBuffer(3)
    for (const line of ['a', 'b', 'c', 'd']) ring.push(line)
    expect(ring.snapshot()).toEqual(['b', 'c', 'd'])
    expect(ring.size).toBe(3)
    expect(ring.dropped).toBe(1)
  })

  it('is bounded under sustained volume', () => {
    const ring = new RingBuffer(2000)
    for (let i = 0; i < 10_000; i += 1) ring.push(`line ${i}`)
    expect(ring.size).toBe(2000)
    expect(ring.dropped).toBe(8000)
    expect(ring.snapshot().at(-1)).toBe('line 9999')
    expect(ring.snapshot()[0]).toBe('line 8000')
  })

  it('returns the tail when asked for fewer lines than it holds', () => {
    const ring = new RingBuffer(10)
    for (let i = 0; i < 10; i += 1) ring.push(`l${i}`)
    expect(ring.snapshot(2)).toEqual(['l8', 'l9'])
  })
})

describe('LogPump', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes on the tick, not on the write — R11.4', () => {
    const flushes: number[] = []
    const pump = new LogPump({
      capacity: 100,
      intervalMs: 100,
      onFlush: (lines) => flushes.push(lines.length),
    })
    pump.start()

    for (let i = 0; i < 500; i += 1) pump.write('skillspector', `line ${i}\n`)
    expect(flushes).toEqual([])

    vi.advanceTimersByTime(100)
    expect(flushes).toEqual([100])
    pump.stop()
  })

  it('bounds state updates by elapsed time, not by line count', () => {
    let flushes = 0
    const pump = new LogPump({ capacity: 2000, intervalMs: 100, onFlush: () => (flushes += 1) })
    pump.start()

    // 10,000 lines spread over five seconds: 50 ticks, so at most 51 flushes.
    for (let step = 0; step < 50; step += 1) {
      for (let i = 0; i < 200; i += 1) pump.write('skillspector', `line ${step}-${i}\n`)
      vi.advanceTimersByTime(100)
    }
    expect(flushes).toBeLessThanOrEqual(51)
    pump.stop()
  })

  it('does not flush when nothing arrived', () => {
    let flushes = 0
    const pump = new LogPump({ capacity: 10, intervalMs: 100, onFlush: () => (flushes += 1) })
    pump.start()
    vi.advanceTimersByTime(500)
    expect(flushes).toBe(0)
    pump.stop()
  })

  it('assembles a line split across chunks', () => {
    const seen: string[][] = []
    const pump = new LogPump({
      capacity: 10,
      intervalMs: 100,
      onFlush: (lines) => seen.push([...lines]),
    })
    pump.start()
    pump.write('t', 'hello ')
    pump.write('t', 'world\n')
    vi.advanceTimersByTime(100)
    expect(seen.at(-1)).toEqual(['t │ hello world'])
    pump.stop()
  })

  it('does not splice two sources together', () => {
    const seen: string[][] = []
    const pump = new LogPump({
      capacity: 10,
      intervalMs: 100,
      onFlush: (lines) => seen.push([...lines]),
    })
    pump.start()
    pump.write('a', 'first half ')
    pump.write('b', 'other tool\n')
    pump.write('a', 'second half\n')
    vi.advanceTimersByTime(100)
    expect(seen.at(-1)).toEqual(['b │ other tool', 'a │ first half second half'])
    pump.stop()
  })

  it('reports how many lines it dropped so the pane can point at the file', () => {
    let dropped = -1
    const pump = new LogPump({ capacity: 5, intervalMs: 100, onFlush: (_l, d) => (dropped = d) })
    pump.start()
    for (let i = 0; i < 20; i += 1) pump.write('t', `line ${i}\n`)
    vi.advanceTimersByTime(100)
    expect(dropped).toBe(15)
    pump.stop()
  })

  it('flushes what it holds when stopped', () => {
    const seen: string[][] = []
    const pump = new LogPump({
      capacity: 10,
      intervalMs: 100,
      onFlush: (lines) => seen.push([...lines]),
    })
    pump.start()
    pump.write('t', 'last\n')
    pump.stop()
    expect(seen.at(-1)).toEqual(['t │ last'])
  })
})
