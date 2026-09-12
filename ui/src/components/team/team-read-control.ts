export class TeamReadControl {
  private paused = false
  private pending: Promise<void> | null = null
  async read(operation: () => Promise<void>): Promise<void> {
    if (this.paused || this.pending) return
    const pending = operation()
    this.pending = pending
    try { await pending }
    finally { if (this.pending === pending) this.pending = null }
  }
  async markUnread(operation: () => Promise<void>): Promise<void> {
    this.paused = true
    await this.pending?.catch(() => {})
    try { await operation() }
    catch (error) { this.paused = false; throw error }
  }
}
