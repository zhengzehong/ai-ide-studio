import { useMemo, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../stores/app.store'
import { showToast } from '../utils/toast'

const PRESET_COLORS = [
  '#6c5ce7', // primary purple
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // orange
  '#ef4444', // red
  '#6a7480', // gray
]

const PRESET_ICONS = ['📦', '🚀', '🎯', '💻', '🔧', '📚', '🎨', '⚡', '🌟', '🔥', '💡', '🛠️']

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
}

export default function ProjectCreateSheet({ open, onClose, onCreated }: Props) {
  const createProject = useAppStore((s) => s.createProject)
  const [name, setName] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [color, setColor] = useState<string>('')
  const [icon, setIcon] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const effectiveColor = useMemo(() => color || PRESET_COLORS[0], [color])
  const effectiveIcon = useMemo(() => icon || PRESET_ICONS[0], [icon])

  if (!open) return null

  const canSubmit = name.trim().length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const row = await createProject({
        name: name.trim(),
        workDir: workDir.trim() || undefined,
        color: color || undefined,
        icon: icon || undefined,
      })
      showToast('项目已创建')
      setName('')
      setWorkDir('')
      setColor('')
      setIcon('')
      onCreated(row.id)
      onClose()
    } catch {
      showToast('创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>新建项目</span>
          <button className="pressable" style={styles.closeBtn} onClick={onClose}>
            <X size={20} color="var(--text-secondary)" />
          </button>
        </div>
        <div style={styles.body}>
          <div style={styles.previewRow}>
            <div style={{ ...styles.previewIcon, background: effectiveColor }}>
              {effectiveIcon}
            </div>
            <span style={styles.previewName}>{name.trim() || '项目名称'}</span>
          </div>

          <label style={styles.label}>
            项目名称 <span style={{ color: 'var(--error)' }}>*</span>
          </label>
          <input
            style={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入项目名称"
            autoFocus
            maxLength={40}
          />

          <label style={styles.label}>工作目录</label>
          <input
            style={styles.input}
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="可选,留空则后续在 PC 端补充"
            maxLength={200}
          />

          <label style={styles.label}>颜色</label>
          <div style={styles.colorRow}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className="pressable"
                style={{
                  ...styles.colorDot,
                  background: c,
                  ...(color === c ? styles.colorDotActive : {}),
                }}
                onClick={() => setColor(c)}
                aria-label={`选择颜色 ${c}`}
              />
            ))}
          </div>

          <label style={styles.label}>图标</label>
          <div style={styles.iconRow}>
            {PRESET_ICONS.map((emoji) => (
              <button
                key={emoji}
                className="pressable"
                style={{
                  ...styles.iconDot,
                  ...(icon === emoji ? styles.iconDotActive : {}),
                }}
                onClick={() => setIcon(emoji)}
                aria-label={`选择图标 ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.footer}>
          <button className="pressable" style={styles.btnSecondary} onClick={onClose}>取消</button>
          <button
            className="pressable"
            style={{ ...styles.btnPrimary, opacity: canSubmit ? 1 : 0.5 }}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? '创建中...' : '创建'}
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
    background: 'rgba(0,0,0,0.4)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px 12px',
    borderBottom: '0.5px solid var(--border-light)',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  closeBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: '16px 20px',
    overflowY: 'auto',
    paddingBottom: 'calc(16px + var(--safe-bottom))',
  },
  previewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    padding: '12px',
    background: 'var(--bg-input)',
    borderRadius: 10,
  },
  previewIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: '#fff',
    flexShrink: 0,
  },
  previewName: {
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    marginTop: 14,
    color: 'var(--text-secondary)',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '0.5px solid var(--border)',
    borderRadius: 10,
    fontSize: 14,
    outline: 'none',
    color: 'var(--text-primary)',
    background: 'var(--bg-card)',
    boxSizing: 'border-box',
  },
  colorRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '2px solid transparent',
    cursor: 'pointer',
    padding: 0,
  },
  colorDotActive: {
    border: '2px solid var(--primary)',
    boxShadow: '0 0 0 2px #fff inset',
  },
  iconRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  iconDot: {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: '0.5px solid var(--border)',
    background: 'var(--bg-card)',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  iconDotActive: {
    border: '1.5px solid var(--primary)',
    background: 'var(--primary-bg)',
  },
  footer: {
    padding: '12px 20px calc(12px + var(--safe-bottom))',
    borderTop: '0.5px solid var(--border-light)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnPrimary: {
    padding: '8px 20px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '8px 20px',
    borderRadius: 10,
    border: '0.5px solid var(--border)',
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    fontSize: 14,
    cursor: 'pointer',
  },
}
