import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, AlertTriangle, Sparkles, Loader2, Edit3, Trash2 } from 'lucide-react'
import { useSessionStore } from '../stores/session.store'
import { useAppStore } from '../stores/app.store'
import type { SessionTemplateData } from '@desktop/stores/session.store'
import ConfirmDialog from '../components/ConfirmDialog'

interface EditState {
  template: SessionTemplateData
  name: string
  description: string
}

export default function TemplateListPage() {
  const navigate = useNavigate()
  const agents = useAppStore((s) => s.agents)
  const listSessionTemplates = useSessionStore((s) => s.listSessionTemplates)
  const deleteSessionTemplate = useSessionStore((s) => s.deleteSessionTemplate)
  const updateSessionTemplate = useSessionStore((s) => s.updateSessionTemplate)

  const [templates, setTemplates] = useState<SessionTemplateData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<SessionTemplateData | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listSessionTemplates()
      setTemplates(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载模板失败')
    } finally {
      setLoading(false)
    }
  }, [listSessionTemplates])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void fetchTemplates()
    })
    return () => { cancelled = true }
  }, [fetchTemplates])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await deleteSessionTemplate(deleting.id)
      setToast('已删除')
      setDeleting(null)
      await fetchTemplates()
    } catch (err) {
      setToast(err instanceof Error ? err.message : '删除失败')
      setDeleting(null)
    }
  }

  const handleEditSave = async () => {
    if (!editing) return
    const trimmedName = editing.name.trim()
    if (!trimmedName) {
      setToast('名称不能为空')
      return
    }
    try {
      await updateSessionTemplate(editing.template.id, {
        name: trimmedName,
        description: editing.description.trim(),
      })
      setToast('已保存')
      setEditing(null)
      await fetchTemplates()
    } catch (err) {
      setToast(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/settings')}>
          <ChevronLeft size={18} color="var(--text-secondary)" />
        </button>
        <div style={styles.headerTitle}>
          <Sparkles size={18} color="var(--primary)" />
          <span>会话模板</span>
        </div>
        <button style={styles.refreshBtn} onClick={fetchTemplates}>
          <RefreshCw size={14} color="var(--text-secondary)" />
        </button>
      </div>

      <div style={styles.hint}>
        模板是完整对话镜像(ACP fork),新建时整个上下文都会被复制。
      </div>

      {error && (
        <div style={styles.errorBar}>
          <AlertTriangle size={14} color="var(--error)" />
          <span style={{ flex: 1 }}>{error}</span>
          <button style={styles.retryBtn} onClick={fetchTemplates}>重试</button>
        </div>
      )}

      <div style={styles.list}>
        {loading && templates.length === 0 ? (
          <div style={styles.loading}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            <span>加载中...</span>
          </div>
        ) : templates.length === 0 ? (
          <div style={styles.empty}>
            <Sparkles size={36} color="var(--text-muted)" strokeWidth={1.2} />
            <div style={styles.emptyTitle}>暂无会话模板</div>
            <div style={styles.emptyDesc}>在会话列表长按会话 → 发布为模板</div>
          </div>
        ) : (
          templates.map((template) => {
            const agent = agents.find((a) => a.id === template.agent_id)
            return (
              <div key={template.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={styles.cardTitle}>{template.name}</div>
                  <div style={styles.cardActions}>
                    <button
                      style={styles.iconActionBtn}
                      onClick={() => setEditing({
                        template,
                        name: template.name,
                        description: template.description ?? '',
                      })}
                      aria-label="编辑"
                    >
                      <Edit3 size={14} color="var(--text-secondary)" />
                    </button>
                    <button
                      style={styles.iconActionBtn}
                      onClick={() => setDeleting(template)}
                      aria-label="删除"
                    >
                      <Trash2 size={14} color="var(--error)" />
                    </button>
                  </div>
                </div>
                {template.description && (
                  <div style={styles.cardDesc}>{template.description}</div>
                )}
                <div style={styles.cardMeta}>
                  <span style={styles.metaTag}>{agent?.name ?? template.agent_id.slice(0, 8)}</span>
                  <span style={styles.metaText}>使用 {template.use_count} 次</span>
                  <span style={styles.metaText}>· {formatDate(template.created_at)}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {editing && (
        <EditTemplateDialog
          state={editing}
          onChange={(next) => setEditing(next)}
          onSave={handleEditSave}
          onCancel={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除模板"
        message={`确定删除模板「${deleting?.name ?? ''}」吗?基于该模板新建的会话不受影响。`}
        confirmText="删除"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

interface EditDialogProps {
  state: EditState
  onChange: (next: EditState) => void
  onSave: () => void
  onCancel: () => void
}

function EditTemplateDialog({ state, onChange, onSave, onCancel }: EditDialogProps) {
  const canSubmit = !!state.name.trim()
  return (
    <div style={editStyles.overlay} onClick={onCancel}>
      <div style={editStyles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={editStyles.title}>编辑模板</div>
        <div style={editStyles.field}>
          <label style={editStyles.label}>
            模板名称 <span style={{ color: 'var(--error)' }}>*</span>
          </label>
          <input
            value={state.name}
            onChange={(e) => onChange({ ...state, name: e.target.value })}
            autoFocus
            style={editStyles.input}
          />
        </div>
        <div style={editStyles.field}>
          <label style={editStyles.label}>描述</label>
          <textarea
            value={state.description}
            onChange={(e) => onChange({ ...state, description: e.target.value })}
            rows={3}
            style={editStyles.textarea}
          />
        </div>
        <div style={editStyles.actions}>
          <button style={editStyles.cancelBtn} onClick={onCancel}>取消</button>
          <button
            style={{
              ...editStyles.confirmBtn,
              background: canSubmit ? 'var(--primary)' : 'var(--text-muted)',
            }}
            disabled={!canSubmit}
            onClick={onSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    paddingTop: 'calc(12px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  backBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 17,
    fontWeight: 700,
    flex: 1,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
  },
  hint: {
    padding: '8px 16px',
    fontSize: 12,
    color: 'var(--text-muted)',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  errorBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: 'rgba(250,81,81,0.08)',
    color: 'var(--error)',
    fontSize: 13,
    flexShrink: 0,
  },
  retryBtn: {
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid var(--error)',
    background: 'transparent',
    color: 'var(--error)',
    fontSize: 12,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
    minHeight: 0,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 32,
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 0',
    color: 'var(--text-muted)',
  },
  emptyTitle: {
    marginTop: 8,
    fontSize: 14,
    color: 'var(--text-secondary)',
  },
  emptyDesc: {
    marginTop: 4,
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  card: {
    background: 'var(--bg-card)',
    borderRadius: 10,
    border: '1px solid var(--border-light)',
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardActions: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  iconActionBtn: {
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    borderRadius: 6,
  },
  cardDesc: {
    marginTop: 4,
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  cardMeta: {
    marginTop: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaTag: {
    fontSize: 11,
    color: 'var(--primary)',
    background: 'rgba(22,119,255,0.08)',
    padding: '2px 8px',
    borderRadius: 4,
  },
  metaText: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  toast: {
    position: 'fixed',
    bottom: 80,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    fontSize: 13,
    zIndex: 9999,
  },
}

const editStyles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.35)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    background: 'var(--bg-card)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    padding: '20px 20px 12px',
    textAlign: 'center',
  },
  field: {
    padding: '0 20px 12px',
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
  actions: {
    display: 'flex',
    borderTop: '1px solid var(--border-light)',
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    fontSize: 15,
    color: 'var(--text-secondary)',
    borderRight: '1px solid var(--border-light)',
  },
  confirmBtn: {
    flex: 1,
    height: 46,
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
  },
}
