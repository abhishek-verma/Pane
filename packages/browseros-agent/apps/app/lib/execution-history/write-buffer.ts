import type { ExecutionTaskRecord } from './types'

/** Coalesce token updates before touching extension storage. Keep each task's
 * latest state (including terminal states), never a promise per streamed token.
 */
export class ExecutionHistoryWriteBuffer {
  private pending = new Map<string, ExecutionTaskRecord>()
  private saved = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing = false

  constructor(
    private persist: (task: ExecutionTaskRecord) => Promise<void>,
    private report: (error: unknown, task: ExecutionTaskRecord) => void,
    private intervalMs = 1000,
  ) {}

  enqueue(task: ExecutionTaskRecord): void {
    this.pending.set(task.id, task)
    if (task.status !== 'running' && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.schedule(task.status === 'running' ? this.intervalMs : 0)
  }

  private schedule(delay: number): void {
    if (this.writing || this.timer || !this.pending.size) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, delay)
  }

  async flush(): Promise<void> {
    if (this.writing) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.writing = true
    const batch = [...this.pending.values()]
    this.pending.clear()
    try {
      for (const task of batch) {
        try {
          const hash = JSON.stringify(task)
          if (this.saved.get(task.id) === hash) continue
          await this.persist(task)
          this.saved.set(task.id, hash)
          if (task.status !== 'running') this.saved.delete(task.id)
        } catch (error) {
          this.report(error, task)
        }
      }
    } finally {
      this.writing = false
      this.schedule(
        [...this.pending.values()].some((task) => task.status !== 'running')
          ? 0
          : this.intervalMs,
      )
    }
  }
}
