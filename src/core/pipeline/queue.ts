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
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const buffered = this.#buffer.shift()
        if (buffered !== undefined) return { value: buffered, done: false }
        if (this.#closed) return { value: undefined as never, done: true }
        return new Promise((resolve) => this.#resolvers.push(resolve))
      },
    }
  }
}
