import type { CSSProperties } from 'react'

interface AgentSystemPromptFieldProps {
  value: string
  onChange: (value: string) => void
}

export function AgentSystemPromptField({ value, onChange }: AgentSystemPromptFieldProps) {
  return (
    <div>
      <label style={styles.label}>系统提示词</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        placeholder="描述这个 Agent 的职责、工作方式和约束"
        style={styles.textarea}
      />
      <div style={styles.hint}>保存不会中断当前生成，从下一轮消息生效。</div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  label: {
    display: 'block',
    marginBottom: 6,
    color: 'var(--text-2)',
    fontSize: 14,
    fontWeight: 600,
  },
  textarea: {
    width: '100%',
    minHeight: 144,
    padding: '10px 12px',
    boxSizing: 'border-box',
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 6,
    outline: 'none',
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: 1.6,
  },
  hint: {
    marginTop: 6,
    color: 'var(--text-3)',
    fontSize: 12,
    lineHeight: 1.5,
  },
}
