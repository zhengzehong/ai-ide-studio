export interface RuntimeIdleThresholds {
  sessionIdleMs: number
  agentIdleMs: number
}

export interface RuntimeIdleSweepOptions {
  intervalMs: number
  sweep: () => Promise<void>
  onError?: (error: unknown) => void
}

export class RuntimeIdleSweep {
  private timer?: NodeJS.Timeout
  private inFlight?: Promise<void>

  constructor(private readonly options: RuntimeIdleSweepOptions) {}

  start(): void {
    if (this.timer || this.options.intervalMs <= 0) return
    this.timer = setInterval(() => {
      if (this.inFlight) return
      const run = Promise.resolve()
        .then(() => this.options.sweep())
        .catch((error: unknown) => this.options.onError?.(error))
        .then(() => undefined)
        .finally(() => {
          if (this.inFlight === run) this.inFlight = undefined
        })
      this.inFlight = run
    }, this.options.intervalMs)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    await this.inFlight
  }
}
