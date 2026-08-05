import { useEffect, useState } from 'react'

/**
 * Slow enough that a frame is not being rebuilt for the sake of one cell, fast
 * enough to read as motion rather than as a stutter. The log pump already
 * flushes at 100ms while a tool streams, so during the case this exists for —
 * a run in flight — this adds no re-render the frame was not already taking.
 */
export const TICK_MS = 150

/**
 * A frame counter that exists only while something is actually running, because
 * an interval left alive on an idle screen re-renders the whole Work tree
 * forever to animate nothing.
 *
 * It restarts from zero each time it wakes, so the first frame after a run
 * starts is the same frame every time — which is what lets a test assert on it
 * without holding the clock still.
 */
export function useTicker(active: boolean, intervalMs: number = TICK_MS): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    setTick(0)
    const timer = setInterval(() => setTick((n) => n + 1), intervalMs)
    // Node keeps the process alive for a pending interval, and `q` must not
    // have to wait on a decoration to be allowed to end the session.
    timer.unref()
    return () => {
      clearInterval(timer)
    }
  }, [active, intervalMs])
  return active ? tick : 0
}
