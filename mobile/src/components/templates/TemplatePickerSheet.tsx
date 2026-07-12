import { useEffect, useState, type CSSProperties } from 'react'
import { Sparkles, Loader2, FileText } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'
import { useAppStore } from '../../stores/app.store'
import type { SessionTemplateData } from '@desktop/stores/session.store'

interface Props {
  open: boolean
  agentId: string
  onClose: () => void
  onSelect: (sessionId: string) => void
}

export default function TemplatePickerSheet({ open, agentId, onClose, onSelect }: Props) {
  const listSessionTemplates = useSessionStore((s) => s.listSessionTemplates)
  const instantiateSessionTemplate = useSessionStore((s) => s.instantiateSessionTemplate)
  const agents = useAppStore((s) => s.agents)
  const [templates, setTemplates] = useState<SessionTemplateData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [instantiatingId, setInstantiatingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      void listSessionTemplates(agentId)
        .then((rows) => {
          if (!cancelled) setTemplates(rows)
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : '加载模板失败')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [open, agentId, listSessionTemplates])

  if (!open) return null

  const agent = agents.find((a) => a.id === agentId)

  const handlePick = async (template: SessionTemplateData) => {
    setInstantiatingId(template.id)
    setError(null)
    try {
      const session = await instantiateSessionTemplate(template.id)
      onSelect(session.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '从模板新建失败')
    } finally {
      setInstantiatingId(null)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHeader}>
          <div style={styles.titleRow}>
            <Sparkles size={18} color="var(--primary)" />
            <span style={styles.sheetTitle}>从模板新建会话</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div style={styles.hint}>
          模板是完整对话镜像(ACP fork),新建时整个上下文都会被复制。
          {agent && <span style={styles.agentHint}>当前 Agent: {agent.name}</span>}
        </div>

        <div style={styles.list}>
          {loading && (
            <div style={styles.loading}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              <span>加载模板...</span>
            </div>
          )}

          {!loading && templates.length === 0 && !error && (
            <div style={styles.empty}>
              <FileText size={36} color="var(--text-muted)" strokeWidth={1.2} />
              <span style={styles.emptyText}>该 Agent 暂无会话模板</span>
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          {!loading && templates.length > 0 && (
            templates.map((template) => (
              <button
                key={template.id}
                style={{
                  ...styles.item,
                  opacity: instantiatingId !== null && instantiatingId !== template.id ? 0.5 : 1,
                }}
                onClick={() => void handlePick(template)}
                disabled={instantiatingId !== null}
              >
                <div style={styles.itemBody}>
                  <div style={styles.itemName}>{template.name}</div>
                  {template.description && (
                    <div style={styles.itemDesc}>{template.description}</div>
                  )}
                  <div style={styles.itemMeta}>
                    <span>使用 {template.use_count} 次</span>
                    {template.last_used_at && (
                      <span>· 上次 {formatTime(template.last_used_at)}</span>
                    )}
                  </div>
                </div>
                {instantiatingId === template.id && (
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return ''
  }
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.35)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '78vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    borderRadius: '16px 16px 0 0',
  },
  sheetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px 10px',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontWeight: 600,
    fontSize: 16,
  },
  closeBtn: {
    width: 30,
    height: 30,
    fontSize: 22,
    color: 'var(--text-muted)',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    padding: '10px 16px',
    fontSize: 12,
    color: 'var(--text-muted)',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border-light)',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flexShrink: 0,
  },
  agentHint: {
    color: 'var(--primary)',
  },
  list: {
    overflow: 'auto',
    padding: '8px 0 calc(8px + var(--safe-bottom))',
    flex: 1,
    minHeight: 0,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '28px 0',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  empty: {
    padding: '40px 0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-muted)',
  },
  emptyText: {
    fontSize: 14,
  },
  error: {
    margin: '12px 16px',
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(250,81,81,0.08)',
    color: 'var(--error)',
    fontSize: 13,
  },
  item: {
    width: '100%',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    borderBottom: '1px solid var(--border-light)',
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  itemDesc: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMeta: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 4,
    display: 'flex',
    gap: 4,
  },
}
