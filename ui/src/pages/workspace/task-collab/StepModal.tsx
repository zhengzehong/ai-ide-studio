import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { AgentData } from '../../../stores/agent.store'
import { useTaskStore, type TaskStepData, type TaskStepDetailView } from '../../../stores/task.store'

interface StepModalProps {
  taskId: string
  steps: TaskStepData[]
  agents: AgentData[]
  step?: TaskStepDetailView | null
  onClose: () => void
  onSaved: () => void
}

export function StepModal({ taskId, steps, agents, step, onClose, onSaved }: StepModalProps) {
  const addStep = useTaskStore((s) => s.addStep)
  const updateStep = useTaskStore((s) => s.updateStep)
  const editing = Boolean(step)
  const [title, setTitle] = useState(step?.title ?? '')
  const [description, setDescription] = useState(step?.description ?? '')
  const [assignee, setAssignee] = useState(step?.assignee ?? '')
  const [dependsOn, setDependsOn] = useState<string[]>(step?.dependsOn ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dependencyOptions = useMemo(() => steps.filter((item) => item.id !== step?.id), [step?.id, steps])
  const canSave = Boolean(title.trim() && description.trim() && !saving)

  const handleSubmit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (step) {
        await updateStep({
          taskId,
          stepId: step.id,
          title: title.trim(),
          description: description.trim(),
          assignee: assignee || null,
          dependsOn,
        })
      } else {
        await addStep({
          taskId,
          title: title.trim(),
          description: description.trim(),
          assignee: assignee || undefined,
          dependsOn,
        })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存步骤失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={styles.backdrop} />
      <div role="dialog" aria-modal="true" aria-label={editing ? '编辑步骤' : '添加步骤'} style={styles.modal}>
        <header style={styles.header}>
          <strong style={{ fontSize: 15 }}>{editing ? '编辑步骤' : '添加步骤'}</strong>
          <button type="button" onClick={onClose} title="关闭" style={styles.iconButton}>
            <X size={14} />
          </button>
        </header>
        <div style={styles.body}>
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
          <Field label="分派 Agent">
            <select value={assignee} onChange={(event) => setAssignee(event.target.value)} style={styles.input}>
              <option value="">待认领</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="依赖">
            <div style={styles.dependencyBox}>
              {dependencyOptions.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无可选依赖</span>
              ) : (
                dependencyOptions.map((item) => (
                  <label key={item.id} style={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={dependsOn.includes(item.id)}
                      onChange={(event) => {
                        setDependsOn((current) =>
                          event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                        )
                      }}
                    />
                    <span>{item.title}</span>
                  </label>
                ))
              )}
            </div>
          </Field>
          {error && <div style={styles.error}>{error}</div>}
        </div>
        <footer style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            style={{ ...styles.primaryButton, opacity: canSave ? 1 : 0.55 }}
          >
            {saving ? '保存中...' : '保存'}
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
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.28)',
    zIndex: 1100,
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(520px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 48px)',
    background: 'var(--bg-0)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-lg)',
    zIndex: 1101,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '12px 14px',
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
  body: { padding: 14, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' },
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
  dependencyBox: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-1)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 140,
    overflowY: 'auto',
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text-2)' },
  error: { color: 'var(--red)', background: '#fff1f0', borderRadius: 6, padding: '7px 9px', fontSize: 12 },
  footer: {
    padding: '10px 14px',
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
    padding: '7px 14px',
    fontSize: 13,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    padding: '7px 14px',
    fontSize: 13,
    cursor: 'pointer',
  },
}
