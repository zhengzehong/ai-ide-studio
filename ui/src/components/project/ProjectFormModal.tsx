import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ProjectData } from '../../stores/project.store'
import { useProjectStore } from '../../stores/project.store'
import {
  autoColor,
  autoIcon,
} from '../../utils/project-meta'
import { RecentPathSuggestionsButton } from './RecentPathSuggestions'
import { PathCheckHint } from './PathCheckHint'
import { usePathCheck } from './pathCheck'
import { ColorPicker, IconPicker } from './MetaPicker'

export interface ProjectFormValue {
  name: string
  workDir: string
  description: string
  color: string
  icon: string
}

interface ProjectFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: ProjectData | null
  onClose: () => void
  onSubmit: (value: ProjectFormValue) => Promise<void> | void
}

function computeInitialFormState(mode: 'create' | 'edit', initial?: ProjectData | null) {
  if (mode === 'edit' && initial) {
    return {
      name: initial.name,
      workDir: initial.work_dir,
      description: initial.description ?? '',
      color: initial.color ?? '',
      icon: initial.icon ?? '',
    }
  }
  return { name: '', workDir: '', description: '', color: '', icon: '' }
}

export function ProjectFormModal({ open, mode, initial, onClose, onSubmit }: ProjectFormModalProps) {
  const projects = useProjectStore((s) => s.projects)
  const paths = useMemo(() => {
    const seen = new Set<string>()
    const sorted = [...projects].sort((a, b) => {
      const at = a.last_visited_at ? Date.parse(a.last_visited_at) : 0
      const bt = b.last_visited_at ? Date.parse(b.last_visited_at) : 0
      return bt - at
    })
    const result: string[] = []
    for (const p of sorted) {
      const path = p.work_dir?.trim()
      if (!path) continue
      if (seen.has(path)) continue
      seen.add(path)
      result.push(path)
      if (result.length >= 5) break
    }
    return result
  }, [projects])

  const initialFormState = useMemo(() => computeInitialFormState(mode, initial), [mode, initial])

  const [name, setName] = useState(initialFormState.name)
  const [workDir, setWorkDir] = useState(initialFormState.workDir)
  const [description, setDescription] = useState(initialFormState.description)
  const [color, setColor] = useState(initialFormState.color)
  const [icon, setIcon] = useState(initialFormState.icon)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const pathCheck = usePathCheck(workDir, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const effectiveColor = useMemo(() => color || autoColor(name), [color, name])
  const effectiveIcon = useMemo(() => icon || autoIcon(name), [icon, name])

  if (!open) return null

  const canSubmit = name.trim().length > 0 && workDir.trim().length > 0 && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        workDir: workDir.trim(),
        description: description.trim(),
        color,
        icon,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={styles.overlay}
    >
      <form onSubmit={handleSubmit} style={styles.dialog}>
        <div style={styles.header}>
          <span style={styles.title}>{mode === 'create' ? '新建项目' : '编辑项目'}</span>
          <button type="button" onClick={onClose} style={styles.closeBtn} aria-label="关闭">×</button>
        </div>

        <div style={styles.body}>
          <div style={styles.formGroup}>
            <label style={styles.label}>项目名称 <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入项目名称"
              autoFocus
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>工作目录 <span style={{ color: 'var(--red)' }}>*</span></label>
            <div style={styles.workdirRow}>
              <input
                type="text"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder="如 C:\\Users\\...\\my-project 或 /home/user/my-project"
                style={{ ...styles.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }}
              />
              <RecentPathSuggestionsButton
                paths={paths}
                onSelect={setWorkDir}
              />
            </div>
            <PathCheckHint state={pathCheck} />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>描述</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目简述(可选)"
              style={styles.input}
            />
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <ColorPicker color={color} onChange={setColor} />
            <IconPicker icon={icon} onChange={setIcon} effectiveColor={effectiveColor} effectiveIcon={effectiveIcon} />
          </div>

          {error && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>{error}</div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.btnSecondary}>取消</button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{ ...styles.btnPrimary, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  dialog: {
    background: 'var(--bg-0)',
    borderRadius: 10,
    width: 500,
    maxWidth: '90vw',
    maxHeight: '90vh',
    boxShadow: '0 16px 48px rgba(0,0,0,0.16)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '14px 18px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 16, fontWeight: 600, color: 'var(--text-1)' },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    fontSize: 20,
    cursor: 'pointer',
    color: 'var(--text-3)',
    width: 28,
    height: 28,
    borderRadius: 5,
  },
  body: {
    padding: 18,
    overflowY: 'auto',
  },
  formGroup: { marginBottom: 16 },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    color: 'var(--text-1)',
  },
  input: {
    width: '100%',
    padding: '7px 11px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
    color: 'var(--text-1)',
    background: 'var(--bg-0)',
    boxSizing: 'border-box',
  },
  workdirRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  footer: {
    padding: '12px 18px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnPrimary: {
    padding: '7px 18px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
  },
  btnSecondary: {
    padding: '7px 18px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    fontSize: 13,
    cursor: 'pointer',
  },
}
