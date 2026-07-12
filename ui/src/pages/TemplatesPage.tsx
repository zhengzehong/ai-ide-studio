import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, RefreshCw, AlertTriangle, Sparkles, Loader2 } from 'lucide-react'
import { useSessionStore, type SessionTemplateData } from '../stores/session.store'
import { useAgentStore } from '../stores/agent.store'
import { ConfirmDialog, ModalOverlay } from '../components/ModalDialog'

export default function TemplatesPage() {
  const navigate = useNavigate()
  const agents = useAgentStore((s) => s.agents)
  const listSessionTemplates = useSessionStore((s) => s.listSessionTemplates)
  const deleteSessionTemplate = useSessionStore((s) => s.deleteSessionTemplate)
  const updateSessionTemplate = useSessionStore((s) => s.updateSessionTemplate)

  const [templates, setTemplates] = useState<SessionTemplateData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SessionTemplateData | null>(null)
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

  const handleEditSave = async (nextName: string, nextDescription: string) => {
    if (!editing) return
    try {
      await updateSessionTemplate(editing.id, {
        name: nextName,
        description: nextDescription,
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
        <button type="button" onClick={() => navigate('/settings')} style={styles.backBtn}>
          <ChevronLeft size={14} /> 设置
        </button>
        <div style={styles.headerTitle}>
          <Sparkles size={18} color="var(--blue)" />
          <span>会话模板</span>
        </div>
        <button type="button" onClick={fetchTemplates} style={styles.refreshBtn}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      <div style={styles.hint}>
        模板是完整对话镜像(ACP fork),不是 system prompt,新建时整个上下文都会被复制。在工作台右键会话可发布为模板。
      </div>

      {error && (
        <div style={styles.errorBar}>
          <AlertTriangle size={14} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={fetchTemplates} style={styles.retryBtn}>
            <RefreshCw size={12} /> 重试
          </button>
        </div>
      )}

      <div style={styles.tableWrap}>
        {loading && templates.length === 0 ? (
          <div style={styles.loading}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            <span>加载中...</span>
          </div>
        ) : templates.length === 0 ? (
          <div style={styles.empty}>
            <Sparkles size={28} color="var(--text-3)" />
            <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-2)' }}>暂无会话模板</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>
              在工作台会话上右键 → 发布为模板
            </div>
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>名称</th>
                <th style={styles.th}>描述</th>
                <th style={styles.th}>Agent</th>
                <th style={styles.th}>来源会话</th>
                <th style={styles.th}>使用次数</th>
                <th style={styles.th}>创建时间</th>
                <th style={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const agent = agents.find((a) => a.id === template.agent_id)
                return (
                  <tr key={template.id}>
                    <td style={styles.tdName}>{template.name}</td>
                    <td style={styles.td}>{template.description || '—'}</td>
                    <td style={styles.td}>{agent?.name ?? template.agent_id.slice(0, 8)}</td>
                    <td style={styles.tdMono}>{template.source_session_id}</td>
                    <td style={styles.td}>{template.use_count}</td>
                    <td style={styles.td}>{formatDate(template.created_at)}</td>
                    <td style={styles.td}>
                      <button type="button" onClick={() => setEditing(template)} style={styles.actionBtn}>
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(template)}
                        style={{ ...styles.actionBtn, color: 'var(--red)' }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {editing && (
        <EditTemplateModal
          template={editing}
          onClose={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          title="删除模板"
          message={`确定删除模板「${deleting.name}」吗?基于该模板新建的会话不受影响。`}
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

interface EditTemplateModalProps {
  template: SessionTemplateData
  onClose: () => void
  onSave: (name: string, description: string) => void
}

function EditTemplateModal({ template, onClose, onSave }: EditTemplateModalProps) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [saving, setSaving] = useState(false)

  const canSubmit = !!name.trim() && !saving

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    await onSave(name.trim(), description.trim())
    setSaving(false)
  }

  return (
    <ModalOverlay open onClose={onClose} title="编辑模板" width={420}>
      <div style={styles.modalBody}>
        <div style={styles.field}>
          <label style={styles.label}>
            模板名称 <span style={{ color: 'var(--red)' }}>*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            autoFocus
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={styles.textarea}
          />
        </div>
        <div style={styles.modalFooter}>
          <button type="button" onClick={onClose} style={styles.closeBtn}>取消</button>
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
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '20px 28px', background: 'var(--bg-1)' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexShrink: 0 },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  headerTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600, color: 'var(--text-1)', flex: 1 },
  refreshBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  hint: { padding: '8px 12px', borderRadius: 6, background: 'var(--bg-0)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 },
  errorBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, background: 'var(--red-light, #fef2f2)', color: 'var(--red)', fontSize: 13, marginBottom: 12 },
  retryBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: 12, cursor: 'pointer' },
  tableWrap: { flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-0)', borderRadius: 8, border: '1px solid var(--border)' },
  loading: { display: 'flex', alignItems: 'center', gap: 8, padding: 32, justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', color: 'var(--text-3)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)' },
  td: { padding: '10px 12px', fontSize: 13, color: 'var(--text-1)', borderBottom: '1px solid var(--border)' },
  tdName: { padding: '10px 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-1)', borderBottom: '1px solid var(--border)' },
  tdMono: { padding: '10px 12px', fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace', borderBottom: '1px solid var(--border)' },
  actionBtn: { padding: '4px 10px', marginRight: 6, borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' },
  toast: { position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', borderRadius: 8, background: 'var(--text-1)', color: 'var(--bg-0)', fontSize: 13, fontWeight: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.16)', zIndex: 9999 },
  modalBody: { display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: 'var(--text-2)' },
  input: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 14, outline: 'none' },
  textarea: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  closeBtn: { padding: '7px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  submitBtn: { padding: '7px 18px', borderRadius: 6, border: 'none', color: 'white', fontSize: 13, fontWeight: 600 },
}
