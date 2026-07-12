import { useState, type CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import { ModalOverlay } from '../../components/ModalDialog'
import { useSessionStore } from '../../stores/session.store'

interface PublishTemplateModalProps {
  open: boolean
  onClose: () => void
  sessionId: string
  onPublished?: () => void
}

export function PublishTemplateModal({ open, onClose, sessionId, onPublished }: PublishTemplateModalProps) {
  const publishSessionTemplate = useSessionStore((s) => s.publishSessionTemplate)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !!name.trim() && !submitting

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const reset = () => {
    setName('')
    setDescription('')
    setError(null)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await publishSessionTemplate(sessionId, name.trim(), description.trim() || undefined)
      reset()
      onPublished?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布模板失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalOverlay open={open} onClose={handleClose} title="发布为会话模板" width={460}>
      <div style={styles.body}>
        <div style={styles.hint}>
          模板是完整对话镜像(ACP fork),不是 system prompt,新建时整个上下文都会被复制。
        </div>

        <div style={styles.field}>
          <label style={styles.label}>
            模板名称 <span style={{ color: 'var(--red)' }}>*</span>
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

        <div style={styles.footer}>
          <button type="button" onClick={handleClose} disabled={submitting} style={styles.closeBtn}>
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...styles.submitBtn,
              background: canSubmit ? 'var(--blue)' : 'var(--bg-3)',
              cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                发布中...
              </>
            ) : (
              '发布模板'
            )}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

const styles: Record<string, CSSProperties> = {
  body: { display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 },
  hint: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--blue-light)',
    color: 'var(--blue)',
    fontSize: 12,
    lineHeight: 1.5,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: 'var(--text-2)' },
  input: {
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    fontSize: 14,
    outline: 'none',
  },
  textarea: {
    padding: '8px 10px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    fontSize: 14,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  error: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--red-light, #fef2f2)',
    color: 'var(--red)',
    fontSize: 13,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  closeBtn: {
    padding: '7px 16px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    fontSize: 13,
    cursor: 'pointer',
  },
  submitBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 18px',
    borderRadius: 6,
    border: 'none',
    color: 'white',
    fontSize: 13,
    fontWeight: 600,
  },
}
