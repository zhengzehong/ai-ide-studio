import { useEffect, useState, type CSSProperties } from 'react'
import type { ProjectData } from '../../stores/project.store'

interface DeleteConfirmModalProps {
  open: boolean
  project: ProjectData | null
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmModal({ open, project, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const [confirmName, setConfirmName] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || !project) return null

  const nameMatched = confirmName.trim() === project.name

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={styles.overlay}
    >
      <div style={styles.dialog}>
        <div style={styles.header}>
          <span style={styles.title}>删除项目</span>
          <button type="button" onClick={onCancel} style={styles.closeBtn} aria-label="关闭">×</button>
        </div>
        <div style={styles.body}>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)' }}>
            确定要删除项目 <strong style={{ color: 'var(--red)' }}>"{project.name}"</strong> 吗?
          </div>
          <div style={styles.pathBox} title={project.work_dir}>{project.work_dir}</div>
          <div style={styles.warning}>
            <div style={{ marginBottom: 6 }}>⚠️ 此操作不可恢复,将一并删除:</div>
            <ul style={{ margin: '0 0 8px 18px', lineHeight: 1.7 }}>
              <li>该项目下所有会话、Agent、任务、知识库</li>
            </ul>
            <div><strong>不会</strong>删除磁盘上的工作目录文件。</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 12 }}>
            请输入项目名称 <strong style={{ color: 'var(--red)' }}>{project.name}</strong> 以确认:
          </div>
          <input
            key={project.id}
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder="输入项目名称确认"
            autoFocus
            style={{
              ...styles.input,
              marginTop: 6,
              borderColor: confirmName && !nameMatched ? 'var(--red)' : 'var(--border)',
            }}
          />
        </div>
        <div style={styles.footer}>
          <button type="button" onClick={onCancel} style={styles.btnSecondary}>取消</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!nameMatched}
            style={{ ...styles.btnDanger, opacity: nameMatched ? 1 : 0.5, cursor: nameMatched ? 'pointer' : 'not-allowed' }}
          >
            删除
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  dialog: {
    background: 'var(--bg-0)',
    borderRadius: 10,
    width: 420,
    maxWidth: '90vw',
    boxShadow: '0 16px 48px rgba(0,0,0,0.16)',
    overflow: 'hidden',
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
  body: { padding: 18 },
  pathBox: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: 'var(--text-2)',
    background: 'var(--bg-1)',
    padding: '6px 10px',
    borderRadius: 6,
    marginTop: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  warning: {
    background: 'rgba(245, 63, 63, 0.06)',
    border: '1px solid rgba(245, 63, 63, 0.2)',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 12,
    color: 'var(--text-2)',
    marginTop: 12,
    lineHeight: 1.6,
  },
  input: {
    width: '100%',
    padding: '7px 11px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    boxSizing: 'border-box',
  },
  footer: {
    padding: '12px 18px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnSecondary: {
    padding: '7px 16px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    fontSize: 13,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '7px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--red)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
  },
}
