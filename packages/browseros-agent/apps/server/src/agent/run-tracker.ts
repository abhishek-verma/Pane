/**
 * Tracks in-flight agent runs to allow draining during shutdown.
 */
class RunTracker {
  private activeRuns = new Set<string>()
  private drainPromise: Promise<void> | null = null
  private drainResolve: (() => void) | null = null

  startRun(id: string) {
    this.activeRuns.add(id)
  }

  endRun(id: string) {
    this.activeRuns.delete(id)
    if (this.drainResolve && this.activeRuns.size === 0) {
      this.drainResolve()
    }
  }

  async drain(): Promise<void> {
    if (this.activeRuns.size === 0) {
      return Promise.resolve()
    }
    if (!this.drainPromise) {
      this.drainPromise = new Promise((resolve) => {
        this.drainResolve = resolve
      })
    }
    return this.drainPromise
  }
}

export const runTracker = new RunTracker()
