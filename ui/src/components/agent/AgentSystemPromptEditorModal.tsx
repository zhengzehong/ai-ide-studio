import { useEffect, useState, type CSSProperties } from 'react'
import { FileText, Save, X } from 'lucide-react'
import type { AgentData, ProjectAgentInput } from '../../stores/agent.store'
import { buildAgentSystemPromptUpdate } from './agent-settings-update'

interface AgentSystemPromptEditorModalProps {
  agent: AgentData
  onSave: (input: Partial<ProjectAgentInput>) => Promise<void>
  onClose: () => void
}

export function AgentSystemPromptEditorModal({
  agent,
  onSave,
  onClose,
}: AgentSystemPromptEditorModalProps) {
  const [prompt, setPrompt] = useState(agent.system_prompt ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, saving])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(buildAgentSystemPromptUpdate(prompt))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div style={styles.overlay} />
      <section role="dialog" aria-modal="true" aria-labelledby="agent-prompt-editor-title" style={styles.dialog}>
        <header style={styles.header}>
          <div style={styles.heading}>
            <span style={styles.headingIcon}><FileText size={18} /></span>
            <div>
              <h3 id="agent-prompt-editor-title" style={styles.title}>编辑系统提示词</h3>
              <p style={styles.subtitle}>为「{agent.name}」定义职责、工作方式和约束。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} title="关闭" aria-label="关闭" style={styles.iconButton}>
            <X size={17} />
          </button>
        </header>

        <main style={styles.body}>
          <div style={styles.editorHeader}>
            <label htmlFor="agent-system-prompt" style={styles.editorLabel}>提示词内容</label>
            <span style={styles.characterCount}>{prompt.length} 字</span>
          </div>
          <textarea
            id="agent-system-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述这个 Agent 的职责、工作方式和约束"
            spellCheck={false}
            autoFocus
            style={styles.textarea}
          />
          {error && <div style={styles.error}>{error}</div>}
        </main>

        <footer style={styles.footer}>
          <span style={styles.hint}>保存不会中断当前生成，从下一轮消息生效。</span>
          <div style={styles.actions}>
            <button type="button" onClick={onClose} disabled={saving} style={styles.cancelButton}>取消</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} style={styles.saveButton}>
              <Save size={15} />{saving ? '保存中...' : '保存提示词'}
            </button>
          </div>
        </footer>
      </section>
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(15,23,42,0.32)',
  },
  dialog: {
    position: 'fixed',
    left: '50%',
    top: '50%',
    zIndex: 1001,
    width: 760,
    maxWidth: 'calc(100vw - 48px)',
    height: '70vh',
    maxHeight: 'calc(100vh - 64px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transform: 'translate(-50%, -50%)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-0)',
    boxShadow: 'var(--shadow-lg)',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    padding: '18px 20px',
    borderBottom: '1px solid var(--border)',
  },
  heading: { display: 'flex', alignItems: 'center', gap: 11 },
  headingIcon: {
    width: 36,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    background: 'var(--blue-light)',
    color: 'var(--blue)',
  },
  title: { margin: 0, color: 'var(--text-1)', fontSize: 17, fontWeight: 700 },
  subtitle: { margin: '4px 0 0', color: 'var(--text-3)', fontSize: 13 },
  iconButton: {
    width: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text-3)',
    cursor: 'pointer',
  },
  body: {
    minHeight: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: 20,
    background: 'var(--bg-1)',
  },
  editorHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  editorLabel: { color: 'var(--text-2)', fontSize: 13, fontWeight: 600 },
  characterCount: { color: 'var(--text-3)', fontSize: 12 },
  textarea: {
    width: '100%',
    minHeight: 0,
    flex: 1,
    boxSizing: 'border-box',
    resize: 'none',
    padding: '16px 18px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    outline: 'none',
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: 1.75,
  },
  error: {
    marginTop: 10,
    padding: '8px 10px',
    borderRadius: 5,
    background: 'rgba(220,38,38,0.08)',
    color: 'var(--red, #dc2626)',
    fontSize: 12,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '14px 20px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-0)',
  },
  hint: { color: 'var(--text-3)', fontSize: 12 },
  actions: { display: 'flex', alignItems: 'center', gap: 8 },
  cancelButton: {
    padding: '7px 15px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    cursor: 'pointer',
    fontSize: 14,
  },
  saveButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 15px',
    border: 'none',
    borderRadius: 6,
    background: 'var(--blue)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
}
