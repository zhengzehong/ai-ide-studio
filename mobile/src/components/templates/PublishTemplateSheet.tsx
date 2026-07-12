import { useEffect, useState, type CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'

interface Props {
  open: boolean
  sessionId: string
  onClose: () => void
  onPublished?: () => void
}

export default function PublishTemplateSheet({ open, sessionId, onClose, onPublished }: Props) {
  const publishSessionTemplate = useSessionStore((s) => s.publishSessionTemplate)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setError(null)
  }, [open, sessionId])

  if (!open) return null

  const canSubmit = !!name.trim() && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await publishSessionTemplate(sessionId, name.trim(), description.trim() || undefined)
      onPublished?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布模板失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHeader}>
          <span style={styles.sheetTitle}>发布为会话模板</span>
          <button
            style={styles.closeBtn}
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.hint}>
            模板是完整对话镜像(ACP fork),新建时整个上下文都会被复制。
          </div>

          <div style={styles.field}>
            <label style={styles.label}>
              模板名称 <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如:代码审查工作流"
              autoFocus
              style={styles.input}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) void handleSubmit()
              }}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>描述(选填)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单描述这个模板的用途"
              rows={3}
              style={styles.textarea}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={styles.cancelBtn}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...styles.submitBtn,
              background: canSubmit ? 'var(--primary)' : 'var(--text-muted)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>发布中...</span>
              </>
            ) : (
              <span>发布模板</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.35)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    borderRadius: '16px 16px 0 0',
  },
  sheetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px 10px',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  sheetTitle: {
    fontWeight: 600,
    fontSize: 16,
  },
  closeBtn: {
    width: 30,
    height: 30,
    fontSize: 22,
    color: 'var(--text-muted)',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: '12px 16px',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
  hint: {
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(22,119,255,0.08)',
    color: 'var(--primary)',
    fontSize: 12,
    lineHeight: 1.5,
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    height: 38,
    padding: '0 12px',
    fontSize: 14,
    color: 'var(--text-primary)',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    color: 'var(--text-primary)',
    background: 'var(--bg-input)',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  error: {
    marginTop: 8,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(250,81,81,0.08)',
    color: 'var(--error)',
    fontSize: 13,
  },
  footer: {
    display: 'flex',
    gap: 8,
    padding: '10px 16px calc(10px + var(--safe-bottom))',
    borderTop: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    fontSize: 15,
    color: 'var(--text-secondary)',
    background: 'var(--bg)',
    border: '1px solid var(--border-light)',
    borderRadius: 8,
  },
  submitBtn: {
    flex: 1,
    height: 42,
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
}
