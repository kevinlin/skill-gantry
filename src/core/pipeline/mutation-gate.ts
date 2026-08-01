export type MutationAction = 'apply' | 'discard'

export interface MutationDecision {
  action: MutationAction
  reason: 'user' | 'timeout' | 'cancelled'
}

/** R5.14's interval. Overridable per run and in config.json. */
export const DEFAULT_MUTATION_TIMEOUT_MS = 300_000

/**
 * Correlates a prompt with its answer. The pipeline blocks on `request`; a
 * frontend answers with `resolve` off the back of a `mutation:pending` event.
 * Nothing here writes: the gate decides, the executor acts.
 */
export class MutationGate {
  readonly #pending = new Map<string, (decision: MutationDecision) => void>()

  get pendingIds(): string[] {
    return [...this.#pending.keys()]
  }

  request(requestId: string, timeoutMs: number): Promise<MutationDecision> {
    return new Promise<MutationDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.#settle(requestId, { action: 'discard', reason: 'timeout' })
      }, timeoutMs)
      // A pending prompt must not hold the process open on its own.
      timer.unref?.()
      this.#pending.set(requestId, (decision) => {
        clearTimeout(timer)
        resolve(decision)
      })
    })
  }

  resolve(requestId: string, action: MutationAction): boolean {
    return this.#settle(requestId, { action, reason: 'user' })
  }

  discardAll(reason: 'cancelled' | 'timeout' = 'cancelled'): void {
    for (const requestId of this.pendingIds) {
      this.#settle(requestId, { action: 'discard', reason })
    }
  }

  #settle(requestId: string, decision: MutationDecision): boolean {
    const settle = this.#pending.get(requestId)
    if (!settle) return false
    this.#pending.delete(requestId)
    settle(decision)
    return true
  }
}
