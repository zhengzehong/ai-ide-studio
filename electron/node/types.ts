export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled' | 'timed_out' | 'unknown'
export interface NodeRequest {
  type: 'shell' | 'file.upload' | 'file.download'
  command?: string
  cwd?: string
  shell?: 'powershell' | 'pwsh'
  outputEncoding?: 'utf8' | 'gb18030'
  timeoutSeconds: number
  localPath?: string
  overwrite?: boolean
  transfer?: { url: string; ticket: string; size?: number; sha256?: string; maxBytes: number }
}
export interface NodeResult { cwd?: string; exitCode?: number | null; error?: string; truncated?: boolean }
export interface JournalEntry { id: string; state: JobState; result: NodeResult; deadlineAt: number; updatedAt: number }
export type SendFrame = (frame: Record<string, unknown>) => void

export function isTerminal(state: JobState): boolean {
  return ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(state)
}
