import { useEffect, useState, type CSSProperties } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { ModalOverlay } from '../../components/ModalDialog'
import { useSessionStore, type SessionTemplateData } from '../../stores/session.store'
import { agentAvatar, agentColor } from './helpers'
import type { AgentData } from '../../stores/agent.store'
import { ICON_MAP } from '../../components/agent-square/constants'

interface TemplatePickerModalProps {
  open: boolean
  onClose: () => void
  agentId: string
  agent: AgentData | null
  onSelect: (sessionId: string) => void
}

export function TemplatePickerModal({ open, onClose, agentId, agent, onSelect }: TemplatePickerModalProps) {
  const listSessionTemplates = useSessionStore((s) => s.listSessionTemplates)
  const instantiateSessionTemplate = useSessionStore((s) => s.instantiateSessionTemplate)
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
    <ModalOverlay open={open} onClose={onClose} title="从模板新建会话" width={460}>
      <div style={styles.body}>
        <div style={styles.hint}>
          模板是完整对话镜像(ACP fork),不是 system prompt,新建时整个上下文都会被复制。
        </div>

        {loading && (
          <div style={styles.loading}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            <span>加载模板...</span>
          </div>
        )}

        {!loading && templates.length === 0 && !error && (
          <div style={styles.empty}>该 Agent 暂无会话模板</div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {!loading && templates.length > 0 && (
          <div style={styles.list}>
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => handlePick(template)}
                disabled={instantiatingId !== null}
                style={{
                  ...styles.item,
                  cursor: instantiatingId !== null ? 'wait' : 'pointer',
                  opacity: instantiatingId !== null && instantiatingId !== template.id ? 0.5 : 1,
                }}
              >
                <div style={{ ...styles.icon, background: agent ? agentColor(agent) : 'var(--blue)' }}>
                  <TemplateIcon agent={agent} />
                </div>
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
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                )}
              </button>
            ))}
          </div>
        )}

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.closeBtn}>
            取消
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function TemplateIcon({ agent }: { agent: AgentData | null }) {
  if (!agent) return <Sparkles size={14} color="white" />
  const avatar = agentAvatar(agent)
  if (avatar.kind === 'image') {
    return (
      <img
        src={avatar.src}
        alt={agent.name}
        style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
      />
    )
  }
  if (avatar.kind === 'icon') {
    const IconComp = ICON_MAP[avatar.name]
    return IconComp ? <IconComp size={10} color="white" /> : <Sparkles size={14} color="white" />
  }
  return <span style={{ color: 'white', fontSize: 10, fontWeight: 600 }}>{avatar.text}</span>
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
  body: { display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 },
  hint: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--blue-light)',
    color: 'var(--blue)',
    fontSize: 12,
    lineHeight: 1.5,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '24px 0',
    justifyContent: 'center',
    color: 'var(--text-3)',
    fontSize: 13,
  },
  empty: {
    padding: '32px 0',
    textAlign: 'center',
    color: 'var(--text-3)',
    fontSize: 13,
  },
  error: {
    padding: '8px 10px',
    borderRadius: 6,
    background: 'var(--red-light, #fef2f2)',
    color: 'var(--red)',
    fontSize: 13,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-0)',
    textAlign: 'left',
    width: '100%',
  },
  icon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 14, fontWeight: 600, color: 'var(--text-1)' },
  itemDesc: {
    fontSize: 12,
    color: 'var(--text-3)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMeta: { fontSize: 11, color: 'var(--text-3)', marginTop: 4, display: 'flex', gap: 4 },
  footer: { display: 'flex', justifyContent: 'flex-end', marginTop: 4 },
  closeBtn: {
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-0)',
    color: 'var(--text-2)',
    fontSize: 13,
    cursor: 'pointer',
  },
}
