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
  /** 换线/卸载：手动未读的永久暂停只在"当前这条线"成立，跨线必须复位，否则新线永远不标已读。 */
  reset(): void {
    this.paused = false
    this.pending = null
  }
}
