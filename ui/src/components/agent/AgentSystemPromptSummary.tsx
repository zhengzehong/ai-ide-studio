import { FileText, PenLine } from 'lucide-react'
import type { CSSProperties } from 'react'

interface AgentSystemPromptSummaryProps {
  value: string
  onEdit: () => void
}

export function AgentSystemPromptSummary({ value, onEdit }: AgentSystemPromptSummaryProps) {
  const characterCount = value.length

  return (
    <div>
      <div style={styles.label}>系统提示词</div>
      <button type="button" onClick={onEdit} style={styles.entry}>
        <span style={styles.icon}><FileText size={17} /></span>
        <span style={styles.copy}>
          <strong style={styles.title}>{characterCount > 0 ? '已配置' : '未配置'}</strong>
          <span style={styles.meta}>
            {characterCount > 0 ? `${characterCount} 字 · 从下一轮消息生效` : '设置 Agent 的职责、工作方式和约束'}
          </span>
        </span>
        <span style={styles.action}><PenLine size={14} />编辑</span>
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  label: {
    marginBottom: 6,
    color: 'var(--text-2)',
    fontSize: 14,
    fontWeight: 600,
  },
  entry: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '11px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-1)',
    color: 'var(--text-1)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  icon: {
    width: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 6,
    background: 'var(--blue-light)',
    color: 'var(--blue)',
  },
  copy: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  title: { fontSize: 14, fontWeight: 600 },
  meta: {
    overflow: 'hidden',
    color: 'var(--text-3)',
    fontSize: 12,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  action: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    color: 'var(--blue)',
    fontSize: 13,
    fontWeight: 600,
  },
}
