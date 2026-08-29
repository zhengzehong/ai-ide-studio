import type { InspirationNote } from '@desktop/stores/inspiration.store'

export type InspirationStatus = InspirationNote['status']

export function inspirationStatusMeta(status: InspirationStatus): { color: string; label: string; busy?: boolean } {
  switch (status) {
    case 'draft':
      return { color: 'var(--text-muted)', label: '待整理' }
    case 'queued':
      return { color: 'var(--primary-light)', label: '排队中', busy: true }
    case 'processing':
      return { color: 'var(--primary)', label: '整理中', busy: true }
    case 'ready':
      return { color: 'var(--success)', label: '已生成' }
    case 'needs_input':
      return { color: 'var(--warning)', label: '待补充' }
    case 'failed':
      return { color: 'var(--error)', label: '整理失败' }
  }
}

/** 完成态独立于整理状态:completedAt 由「标记完成」写入,可逆 */
export function isNoteCompleted(note: InspirationNote): boolean {
  return Boolean(note.completedAt)
}

/** 卡片摘要:原文第一个非空行 */
export function noteExcerpt(note: InspirationNote, max = 80): string {
  const line = note.sourceMarkdown
    .split('\n')
    .map((row) => row.trim())
    .find((row) => row.length > 0)
  const text = line ?? ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}
