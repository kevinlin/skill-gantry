/** Where the pipeline is. 'starting' and 'done' are windows, not phases. */
export type RunPhase = 'starting' | 'running' | 'awaiting-approval' | 'finalising' | 'done'

/** The four phases R5.13 names. 'queued' belongs to the queue, not to a run. */
export type CancelPhase = 'queued' | 'running' | 'awaiting-approval' | 'finalising'

/**
 * The pre-first-stage window is reported as 'running' and the post-finalisation
 * window as 'finalising', so every cancellation lands on one of the four phases
 * a frontend is written against.
 */
export function reportPhase(phase: RunPhase): CancelPhase {
  if (phase === 'starting') return 'running'
  if (phase === 'done') return 'finalising'
  return phase
}

export class Cancellation {
  readonly #controller = new AbortController()
  #phase: RunPhase = 'starting'
  #reason: string | null = null
  #at: RunPhase | null = null

  get signal(): AbortSignal {
    return this.#controller.signal
  }

  get requested(): boolean {
    return this.#reason !== null
  }

  get reason(): string {
    return this.#reason ?? ''
  }

  /** The phase the pipeline was in when cancellation was requested. */
  get phase(): CancelPhase {
    return reportPhase(this.#at ?? this.#phase)
  }

  enter(phase: RunPhase): void {
    this.#phase = phase
  }

  /** First request wins, so a double cancel yields one event and one reason. */
  request(reason: string): boolean {
    if (this.#reason !== null) return false
    this.#reason = reason
    this.#at = this.#phase
    this.#controller.abort()
    return true
  }
}
