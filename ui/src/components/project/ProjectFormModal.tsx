import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ProjectData } from '../../stores/project.store'
import { useProjectStore } from '../../stores/project.store'
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  autoColor,
  autoIcon,
} from '../../utils/project-meta'
import { RecentPathSuggestionsButton } from './RecentPathSuggestions'

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

type PathCheckState = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'missing' } | { state: 'error', message: string }

export function ProjectFormModal({ open, mode, initial, onClose, onSubmit }: ProjectFormModalProps) {
  const store = useProjectStore()
  const recentPaths = useProjectStore((s) => s.recentPaths)
  const checkPath = useProjectStore((s) => s.checkPath)

  const [name, setName] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('')
  const [icon, setIcon] = useState('')
  const [pathCheck, setPathCheck] = useState<PathCheckState>({ state: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && initial) {
      setName(initial.name)
      setWorkDir(initial.work_dir)
      setDescription(initial.description ?? '')
      setColor(initial.color ?? '')
      setIcon(initial.icon ?? '')
    } else {
      setName('')
      setWorkDir('')
      setDescription('')
      setColor('')
      setIcon('')
    }
    setPathCheck({ state: 'idle' })
    setError(null)
  }, [open, mode, initial])

  useEffect(() => {
    if (!open) return
    const trimmed = workDir.trim()
    if (!trimmed) {
      setPathCheck({ state: 'idle' })
      return
    }
    setPathCheck({ state: 'checking' })
    const handle = setTimeout(() => {
      let cancelled = false
      checkPath(trimmed)
        .then((res) => {
          if (cancelled) return
          if (res.exists && res.isDir) setPathCheck({ state: 'ok' })
          else if (res.exists && !res.isDir) setPathCheck({ state: 'error', message: '路径是文件,不是目录' })
          else setPathCheck({ state: 'missing' })
        })
        .catch(() => {
          if (!cancelled) setPathCheck({ state: 'missing' })
        })
      return () => { cancelled = true }
    }, 500)
    return () => clearTimeout(handle)
  }, [workDir, open, checkPath])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const effectiveColor = useMemo(() => color || autoColor(name), [color, name])
  const effectiveIcon = useMemo(() => icon || autoIcon(name), [icon, name])

  if (!open) return null

  const paths = recentPaths.call(store)

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
            <div style={{ flex: 1 }}>
              <label style={styles.label}>颜色</label>
              <div style={styles.colorGrid}>
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(color === c ? '' : c)}
                    title={c}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: c,
                      border: color === c ? '2px solid var(--text-1)' : '2px solid transparent',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>图标</label>
              <div style={styles.iconGrid}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 5,
                    background: effectiveColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                  }}
                >
                  {effectiveIcon}
                </span>
                {PROJECT_ICONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setIcon(icon === ic ? '' : ic)}
                    title={ic}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 5,
                      background: icon === ic ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-1)',
                      border: icon === ic ? '1px solid var(--blue)' : '1px solid transparent',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
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

function PathCheckHint({ state }: { state: PathCheckState }) {
  if (state.state === 'idle') {
    return <div style={{ ...styles.hint, color: 'var(--text-3)' }}>手动输入完整路径,或从最近使用的路径中选择</div>
  }
  if (state.state === 'checking') {
    return <div style={{ ...styles.hint, color: 'var(--text-3)' }}>检查中...</div>
  }
  if (state.state === 'ok') {
    return <div style={{ ...styles.hint, color: 'var(--green)' }}>✓ 路径存在</div>
  }
  if (state.state === 'missing') {
    return <div style={{ ...styles.hint, color: 'var(--red)' }}>✗ 路径不存在(仍可强制保存)</div>
  }
  return <div style={{ ...styles.hint, color: 'var(--red)' }}>✗ {state.message}</div>
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
  hint: { fontSize: 11, marginTop: 4 },
  colorGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  iconGrid: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
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
