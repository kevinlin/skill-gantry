/** Single-producer, single-consumer async queue backing the event stream. */
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
          awaiting = resolve
          this.#resolvers.push(resolve)
        })
      },
      return: async (): Promise<IteratorResult<T>> => {
        if (awaiting) {
          const index = this.#resolvers.indexOf(awaiting)
          if (index !== -1) this.#resolvers.splice(index, 1)
          awaiting = undefined
        }
        return { value: undefined as never, done: true }
      },
    }
  }
}
