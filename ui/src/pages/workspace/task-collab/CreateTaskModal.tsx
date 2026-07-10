import { useState } from 'react'
import { X } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import { useTaskStore, type TaskData } from '../../../stores/task.store'

type CreateMode = 'collab' | 'simple'

interface CreateTaskModalProps {
  agents: AgentData[]
  projectId: string | null
  onClose: () => void
  onCreated?: (task: TaskData) => void
}

export function CreateTaskModal({ agents, projectId, onClose, onCreated }: CreateTaskModalProps) {
  const createTask = useTaskStore((s) => s.createTask)
  const createSimpleTask = useTaskStore((s) => s.createSimpleTask)
  const [mode, setMode] = useState<CreateMode>('collab')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canCreate = Boolean(title.trim() && description.trim() && !saving && (mode === 'collab' || assignee))

  const handleCreate = async () => {
    if (!canCreate) return
    setSaving(true)
    setError(null)
    try {
      const task =
        mode === 'collab'
          ? await createTask(title.trim(), description.trim(), projectId ?? undefined)
          : await createSimpleTask({
              title: title.trim(),
              description: description.trim(),
              assignee,
              projectId: projectId ?? undefined,
            })
      onCreated?.(task)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={styles.backdrop} />
      <div role="dialog" aria-modal="true" aria-label="新建任务" style={styles.modal}>
        <header style={styles.header}>
          <strong style={{ fontSize: 16 }}>新建任务</strong>
          <button type="button" onClick={onClose} title="关闭" style={styles.iconButton}>
            <X size={14} />
          </button>
        </header>
        <div style={styles.body}>
          <div style={styles.segmented}>
            {(['collab', 'simple'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                style={{
                  ...styles.segmentButton,
                  ...(mode === item ? styles.segmentButtonActive : {}),
                }}
              >
                {item === 'collab' ? '协作任务' : '简单任务'}
              </button>
            ))}
          </div>
          <Field label="标题">
            <input value={title} onChange={(event) => setTitle(event.target.value)} style={styles.input} autoFocus />
          </Field>
          <Field label="描述">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              style={{ ...styles.input, resize: 'vertical', lineHeight: 1.5 }}
            />
          </Field>
          {mode === 'simple' && (
            <Field label="分派 Agent">
              <select value={assignee} onChange={(event) => setAssignee(event.target.value)} style={styles.input}>
                <option value="">选择 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {error && <div style={styles.error}>{error}</div>}
        </div>
        <footer style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            取消
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={{ ...styles.primaryButton, opacity: canCreate ? 1 : 0.55 }}
          >
            {saving ? '创建中...' : '创建'}
          </button>
        </footer>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
      {children}
    </label>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', zIndex: 1000 },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(480px, calc(100vw - 32px))',
    background: 'var(--bg-0)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-lg)',
    zIndex: 1001,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    marginLeft: 'auto',
    width: 28,
    height: 28,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-1)',
    color: 'var(--text-2)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  segmented: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    padding: 3,
    background: 'var(--bg-2)',
    borderRadius: 7,
  },
  segmentButton: {
    border: '1px solid transparent',
    borderRadius: 5,
    background: 'transparent',
    color: 'var(--text-2)',
    padding: '7px 10px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  segmentButtonActive: { background: 'var(--bg-0)', borderColor: 'var(--border)', color: 'var(--blue)' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-1)',
    color: 'var(--text-1)',
    padding: '8px 10px',
    fontSize: 13,
    outline: 'none',
  },
  error: { color: 'var(--red)', background: '#fff1f0', borderRadius: 6, padding: '7px 9px', fontSize: 12 },
  footer: {
    padding: '10px 16px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  primaryButton: {
    border: 'none',
    borderRadius: 6,
    background: 'var(--blue)',
    color: 'white',
    padding: '7px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    padding: '7px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
}
