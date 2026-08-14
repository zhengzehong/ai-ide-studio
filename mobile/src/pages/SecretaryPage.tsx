import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Archive, Bot, FileText, Mail, MessageSquare, Play, Plus, RefreshCw } from 'lucide-react'
import { useAppStore } from '../stores/app.store'
import { useMobileSecretaryStore, type MobileSecretaryThread } from '../stores/secretary.store'
import { MarkdownView } from '../components/file-viewer/MarkdownView'
import { PresentedFilesOverlay } from '../components/file-viewer/PresentedFilesOverlay'
import type { FilesPresentationInfo } from '@desktop/stores/session-events'
import SecretaryConfigSheet from '../components/SecretaryConfigSheet'
import SecretaryChatOverlay from '../components/SecretaryChatOverlay'

export default function SecretaryPage() {
  const projectId = useAppStore((state) => state.currentProjectId)
  const agents = useAppStore((state) => state.agents)
  const secretaries = useMobileSecretaryStore((state) => state.secretaries)
  const selectedId = useMobileSecretaryStore((state) => state.selectedId)
  const threads = useMobileSecretaryStore((state) => state.threads)
  const loading = useMobileSecretaryStore((state) => state.loading)
  const error = useMobileSecretaryStore((state) => state.error)
  const load = useMobileSecretaryStore((state) => state.load)
  const create = useMobileSecretaryStore((state) => state.create)
  const select = useMobileSecretaryStore((state) => state.select)
  const markRead = useMobileSecretaryStore((state) => state.markRead)
  const archive = useMobileSecretaryStore((state) => state.archive)
  const runNow = useMobileSecretaryStore((state) => state.runNow)
  const setupListeners = useMobileSecretaryStore((state) => state.setupListeners)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [files, setFiles] = useState<FilesPresentationInfo | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => { if (projectId) void load(projectId) }, [load, projectId])
  useEffect(() => setupListeners(), [setupListeners])
  const selected = useMemo(() => secretaries.find((item) => item.id === selectedId) ?? null, [secretaries, selectedId])
  const thread = useMemo(() => threads.find((item) => item.id === selectedThreadId) ?? threads[0] ?? null, [selectedThreadId, threads])

  const chooseThread = (item: MobileSecretaryThread): void => {
    setSelectedThreadId(item.id)
    if (projectId && selected && item.unread) void markRead(projectId, selected.id, item.id)
  }

  const openChat = (): void => { if (selected?.chatSessionId) setChatOpen(true) }

  if (!projectId) return <div style={styles.empty}>请先选择项目</div>
  return (
    <div style={styles.page}>
      <header style={styles.header}><div><h1 style={styles.title}>秘书</h1><span style={styles.subtitle}>当前项目的汇报邮箱</span></div><div style={{ display: 'flex', gap: 4 }}><button type="button" onClick={() => setConfigOpen(true)} aria-label="新建秘书" style={styles.iconButton}><Plus size={18} /></button><button type="button" onClick={() => void load(projectId)} aria-label="刷新" style={styles.iconButton}><RefreshCw size={18} /></button></div></header>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.secretaryStrip}>{secretaries.map((item) => <button type="button" key={item.id} onClick={() => { setSelectedThreadId(null); void select(projectId, item.id) }} style={{ ...styles.secretaryButton, ...(item.id === selectedId ? styles.secretaryActive : {}) }}><Bot size={15} /><span>{item.name}</span><small>{item.enabled ? '运行中' : '停用'}{item.unreadCount > 0 ? ` · ${item.unreadCount}` : ''}</small></button>)}</div>
      {loading ? <div style={styles.empty}>正在加载...</div> : !selected ? <div style={styles.empty}><Mail size={28} /><strong>当前项目没有秘书</strong><span>创建一个项目秘书，自动整理 Agent 进展。</span><button type="button" onClick={() => setConfigOpen(true)} style={styles.action}><Plus size={14} /> 新建秘书</button></div> : <>
        <div style={styles.toolbar}><strong>{selected.name}</strong><span style={{ flex: 1 }} /><button type="button" onClick={() => void runNow(projectId, selected.id)} style={styles.action}><Play size={14} /> 运行</button><button type="button" onClick={openChat} style={styles.action}><MessageSquare size={14} /> 对话</button></div>
        <div style={styles.mailList}>{threads.map((item) => <button type="button" key={item.id} onClick={() => chooseThread(item)} style={{ ...styles.mailRow, ...(item.id === thread?.id ? styles.mailActive : {}) }}><span style={styles.mailTitle}><strong>{item.subject}</strong>{item.unread && <i style={styles.dot} />}</span><span style={styles.summary}>{item.summary || item.bodyMarkdown.slice(0, 90)}</span><small>{item.needsAction ? '需要处理' : item.kind} · {formatTime(item.updatedAt)}</small></button>)}{threads.length === 0 && <div style={styles.empty}>暂无邮件</div>}</div>
        {thread && <section style={styles.detail}><header style={styles.detailHeader}><div><h2>{thread.subject}</h2><small>{formatTime(thread.updatedAt)}</small></div><button type="button" aria-label="归档" onClick={() => selected && void archive(projectId, selected.id, thread.id)} style={styles.iconButton}><Archive size={17} /></button></header><div style={styles.detailBody}><div style={styles.summaryBox}>{thread.summary || '秘书未提供摘要'}</div><MarkdownView content={thread.bodyMarkdown} projectId={projectId} documentPath={thread.attachments[0]?.path ?? ''} />{thread.attachments.length > 0 && <button type="button" style={styles.attachment} onClick={() => setFiles(toPresentation(projectId, thread))}><FileText size={15} /> 查看附件（{thread.attachments.length}）</button>}</div></section>}
      </>}
      {files && <PresentedFilesOverlay presentation={files} onClose={() => setFiles(null)} />}
      {chatOpen && selected?.chatSessionId && <SecretaryChatOverlay projectId={projectId} secretaryId={selected.id} sessionId={selected.chatSessionId} onClose={() => setChatOpen(false)} />}
      {configOpen && <SecretaryConfigSheet agents={agents} saving={saving} onClose={() => setConfigOpen(false)} onSave={async (input) => { setSaving(true); try { await create(projectId, input); setConfigOpen(false) } finally { setSaving(false) } }} />}
    </div>
  )
}

function toPresentation(projectId: string, thread: MobileSecretaryThread): FilesPresentationInfo {
  return { kind: 'files', presentationId: `secretary-${thread.id}`, projectId, title: thread.subject, createdAt: thread.updatedAt, files: thread.attachments.map((item) => ({ path: item.path, title: item.title ?? item.path.split('/').at(-1) ?? item.path, name: item.path.split('/').at(-1) ?? item.path, extension: item.path.includes('.') ? `.${item.path.split('.').at(-1)?.toLowerCase()}` : '', size: 0, kind: item.kind === 'image' || item.kind === 'audio' || item.kind === 'video' || item.kind === 'binary' ? item.kind : 'text', language: 'plaintext' })) }
}

function formatTime(value: string): string { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  header: { minHeight: 54, padding: '8px 14px', paddingTop: 'calc(8px + var(--safe-top))', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  title: { margin: 0, fontSize: 18, color: 'var(--text-primary)' },
  subtitle: { color: 'var(--text-muted)', fontSize: 11 },
  iconButton: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-primary)' },
  secretaryStrip: { display: 'flex', gap: 7, overflowX: 'auto', padding: '9px 12px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  secretaryButton: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', border: '1px solid var(--border-light)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: 12 },
  secretaryActive: { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--primary-light)' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 6, padding: '11px 13px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' },
  action: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 30, padding: '0 8px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: 11 },
  mailList: { flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--bg)' },
  mailRow: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 5, padding: '12px 14px', border: 0, borderBottom: '1px solid var(--border-light)', background: 'transparent', textAlign: 'left', color: 'var(--text-secondary)' },
  mailActive: { background: 'var(--primary-light)' },
  mailTitle: { display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-primary)', fontSize: 13 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)' },
  summary: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' },
  detail: { position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  detailHeader: { minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 13px', paddingTop: 'calc(8px + var(--safe-top))', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  detailBody: { minHeight: 0, flex: 1, overflowY: 'auto', padding: 14, color: 'var(--text-secondary)', fontSize: 13 },
  summaryBox: { padding: 10, marginBottom: 14, borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12 },
  attachment: { display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 15, padding: '8px 10px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)' },
  error: { margin: 10, padding: 9, borderRadius: 6, background: '#fff1f2', color: 'var(--error)', fontSize: 12 },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, color: 'var(--text-muted)', fontSize: 13 },
}
