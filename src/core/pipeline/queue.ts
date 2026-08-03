/**
 * Single-producer async queue backing the event stream. Built for one
 * consumer at a time, but a second can briefly overlap — the TUI remounting
 * its Work screen against a still-live queue, for instance — which is exactly
 * the case `[Symbol.asyncIterator]`'s `return()` defends against below.
 */
export class AsyncEventQueue<T> {
  #buffer: T[] = []
  #resolvers: Array<(value: IteratorResult<T>) => void> = []
  #closed = false

  push(value: T): void {
    if (this.#closed) return
    const resolve = this.#resolvers.shift()
    if (resolve) resolve({ value, done: false })
    else this.#buffer.push(value)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const resolve of this.#resolvers) resolve({ value: undefined as never, done: true })
    this.#resolvers = []
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    // A resolver waiting on `next()` at the moment a consumer walks away — the
    // TUI remounting its Work screen against a live queue, say — must not sit
    // in the shared queue to be handed a later push by `#resolvers.shift()`'s
    // FIFO order; that silently steals the next event from whichever consumer
    // reads afterwards. `return()` is the iterator protocol's own hook for a
    // `for await` loop's caller to say "no more reads", so a consumer that
    // dereferences its iterator can retract exactly the resolver it parked.
    let awaiting: ((value: IteratorResult<T>) => void) | undefined
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const buffered = this.#buffer.shift()
        if (buffered !== undefined) return { value: buffered, done: false }
        if (this.#closed) return { value: undefined as never, done: true }
        return new Promise((resolve) => {
          // Cleared on its own resolution, not just in `return()`: otherwise
          // a `return()` called between two `next()` calls — no read in
          // flight — would find a stale reference to an already-settled
          // resolver left over from the previous read.
          const settle = (result: IteratorResult<T>): void => {
            awaiting = undefined
            resolve(result)
          }
          awaiting = settle
          this.#resolvers.push(settle)
        })
      },
      return: async (): Promise<IteratorResult<T>> => {
        // Settles the parked `next()` too, not just retracts it from the
        // shared queue: otherwise the caller's `await iterator.next()` never
        // resolves, and the code after it — the very cleanup this exists to
        // let run — is unreachable.
        if (awaiting) {
          const index = this.#resolvers.indexOf(awaiting)
          if (index !== -1) this.#resolvers.splice(index, 1)
          awaiting({ value: undefined as never, done: true })
        }
        return { value: undefined as never, done: true }
      },
    }
  }
}
