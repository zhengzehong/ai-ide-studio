import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, Bot, FileText, Mail, MessageSquare, MonitorUp, Play, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useAppStore } from '../stores/app.store'
import { useMobileSecretaryStore, type MobileSecretary, type MobileSecretaryThread } from '../stores/secretary.store'
import { MarkdownView } from '../components/file-viewer/MarkdownView'
import { PresentedFilesOverlay } from '../components/file-viewer/PresentedFilesOverlay'
import type { FilesPresentationInfo } from '@desktop/stores/session-events'
import { SecretaryConfigSheet } from '../components/SecretaryConfigSheet'
import { SecretaryOverview } from '../components/SecretaryOverview'
import { secretaryAttentionCount } from '@desktop/stores/secretary-attention'

export default function SecretaryPage() {
  const navigate = useNavigate()
  const { secretaryId: routeSecretaryId, threadId } = useParams<{ secretaryId?: string; threadId?: string }>()
  const projectId = useAppStore((state) => state.currentProjectId)
  const agents = useAppStore((state) => state.agents)
  const fetchAgents = useAppStore((state) => state.fetchAgents)
  const store = useMobileSecretaryStore()
  const [files, setFiles] = useState<FilesPresentationInfo | null>(null)
  const [editing, setEditing] = useState<MobileSecretary | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!projectId) return
    void fetchAgents(projectId)
  }, [fetchAgents, projectId])
  useEffect(() => {
    if (!projectId || !routeSecretaryId || routeSecretaryId === store.selectedId) return
    if (store.secretaries.some((item) => item.id === routeSecretaryId)) void store.select(projectId, routeSecretaryId)
  }, [projectId, routeSecretaryId, store.secretaries, store.select, store.selectedId])

  const selected = useMemo(
    () => store.secretaries.find((item) => item.id === (routeSecretaryId ?? store.selectedId)) ?? null,
    [routeSecretaryId, store.secretaries, store.selectedId],
  )
  const thread = useMemo(
    () => threadId ? store.threads.find((item) => item.id === threadId) ?? null : null,
    [store.threads, threadId],
  )

  useEffect(() => {
    if (projectId && selected && thread?.unread) {
      void store.markRead(projectId, selected.id, thread.id).catch(() => undefined)
    }
  }, [projectId, selected, store.markRead, thread])

  const chooseSecretary = (id: string): void => {
    if (!projectId) return
    setNotice('')
    navigate('/secretary', { replace: Boolean(threadId) })
    void store.select(projectId, id)
  }

  const openThread = (item: MobileSecretaryThread): void => {
    if (selected) navigate(`/secretary/${selected.id}/${item.id}`)
  }

  const runSelected = async (): Promise<void> => {
    if (!projectId || !selected) return
    setNotice('')
    try {
      await store.runNow(projectId, selected.id)
      setNotice('已加入运行队列')
    } catch {
      setNotice('运行失败')
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (!projectId || !selected || !window.confirm(`确定删除秘书“${selected.name}”？`)) return
    try {
      await store.remove(projectId, selected.id)
      navigate('/secretary', { replace: true })
    } catch {
      setNotice('删除失败')
    }
  }

  const archiveThread = async (): Promise<void> => {
    if (!projectId || !selected || !thread) return
    try {
      await store.archive(projectId, selected.id, thread.id)
      navigate('/secretary', { replace: true })
    } catch {
      setNotice('归档失败')
    }
  }

  const openSession = (sessionId: string | null): void => {
    if (!sessionId || !selected || !projectId) return
    const search = new URLSearchParams({ projectId, secretaryId: selected.id })
    navigate(`/chat/${encodeURIComponent(sessionId)}?${search.toString()}`, { state: { returnTo: '/secretary' } })
  }

  if (!projectId) return <div style={styles.empty}>请先选择项目</div>
  if (threadId) {
    return (
      <div style={styles.page}>
        <header style={styles.detailHeader}>
          <button type="button" onClick={() => navigate('/secretary', { replace: true })} aria-label="返回秘书邮箱" style={styles.iconButton}><ArrowLeft size={20} /></button>
          <div style={styles.detailHeading}><strong>{thread?.subject ?? '邮件详情'}</strong><small>{thread ? formatTime(thread.updatedAt) : '正在加载...'}</small></div>
          <button type="button" disabled={!thread} aria-label="归档" title="归档" onClick={() => void archiveThread()} style={styles.iconButton}><Archive size={18} /></button>
        </header>
        {thread ? <div style={styles.detailBody}><div style={styles.summaryBox}>{thread.summary || '秘书未提供摘要'}</div><MarkdownView content={thread.bodyMarkdown} projectId={projectId} documentPath={thread.attachments[0]?.path ?? ''} />{thread.attachments.length > 0 && <button type="button" style={styles.attachment} onClick={() => setFiles(toPresentation(projectId, thread))}><FileText size={15} /> 查看附件（{thread.attachments.length}）</button>}</div> : <div style={styles.empty}>正在加载邮件...</div>}
        {files && <PresentedFilesOverlay presentation={files} onClose={() => setFiles(null)} />}
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerCopy}><h1 style={styles.title}>秘书</h1><span style={styles.subtitle}>当前项目的汇报邮箱</span></div>
        <button type="button" onClick={() => { setEditing(null); setConfigOpen(true) }} aria-label="新建秘书" title="新建秘书" style={styles.iconButton}><Plus size={18} /></button>
        <button type="button" onClick={() => void store.load(projectId)} aria-label="刷新" title="刷新" style={styles.iconButton}><RefreshCw size={18} /></button>
      </header>
      {store.error && <div style={styles.error}>{store.error}</div>}
      <div style={styles.secretaryStrip}>{store.secretaries.map((item) => { const count = secretaryAttentionCount(item); return <button type="button" key={item.id} data-chat-unread={item.chatUnread || undefined} onClick={() => chooseSecretary(item.id)} style={{ ...styles.secretaryButton, ...(item.id === store.selectedId ? styles.secretaryActive : {}) }}><Bot size={15} /><span>{item.name}</span>{count > 0 && <b>{count}</b>}</button> })}</div>
      {store.loading ? <div style={styles.empty}>正在加载...</div> : !selected ? <EmptySecretary onCreate={() => { setEditing(null); setConfigOpen(true) }} /> : <>
        <div style={styles.toolbar}>
          <div style={styles.secretaryMeta}><strong>{selected.name}</strong><small>{selected.enabled ? '运行中' : '已停用'} · {selected.observeAll ? '全部 Agent' : `${selected.observedAgentIds.length} 个 Agent`}</small></div>
          <button type="button" disabled={!selected.enabled} onClick={() => void runSelected()} aria-label="立即运行" title={selected.enabled ? '立即运行' : '请先启用秘书'} style={styles.iconButton}><Play size={17} /></button>
          <button type="button" disabled={!selected.runtimeSessionId} onClick={() => openSession(selected.runtimeSessionId)} aria-label="后台执行会话" title="后台执行会话" style={styles.iconButton}><MonitorUp size={17} /></button>
          <button type="button" data-chat-unread={selected.chatUnread || undefined} disabled={!selected.chatSessionId} onClick={() => openSession(selected.chatSessionId)} aria-label="秘书对话" title="秘书对话" style={{ ...styles.iconButton, position: 'relative' }}><MessageSquare size={17} />{selected.chatUnread && <span style={styles.chatDot} />}</button>
          <button type="button" onClick={() => { setEditing(selected); setConfigOpen(true) }} aria-label="设置秘书" title="设置秘书" style={styles.iconButton}><Settings2 size={17} /></button>
          <button type="button" onClick={() => void deleteSelected()} aria-label="删除秘书" title="删除秘书" style={styles.iconButton}><Trash2 size={17} /></button>
        </div>
        {notice && <div style={styles.notice}>{notice}</div>}
        <SecretaryOverview secretary={selected} runs={store.runs} loading={store.runsLoading} onOpenRuntime={() => openSession(selected.runtimeSessionId)} onOpenChat={() => openSession(selected.chatSessionId)} />
        <div style={styles.mailHeading}>秘书汇报 <span>{store.threads.length}</span></div>
        <div style={styles.mailList}>{store.threads.map((item) => <button type="button" key={item.id} onClick={() => openThread(item)} style={styles.mailRow}><span style={styles.mailTitle}><strong>{item.subject}</strong>{item.unread && <i style={styles.dot} />}</span><span style={styles.summary}>{item.summary || item.bodyMarkdown.slice(0, 90)}</span><small>{item.needsAction ? '需要处理' : item.kind} · {formatTime(item.updatedAt)}</small></button>)}{store.threads.length === 0 && <div style={styles.empty}>暂无邮件</div>}</div>
      </>}
      {configOpen && <SecretaryConfigSheet secretary={editing} agents={agents} saving={store.saving} onClose={() => setConfigOpen(false)} onSave={async (input) => { if (editing) await store.update(projectId, editing.id, input); else await store.create(projectId, input); setConfigOpen(false) }} />}
    </div>
  )
}

function EmptySecretary({ onCreate }: { onCreate: () => void }) {
  return <div style={styles.empty}><Mail size={28} /><strong>当前项目没有秘书</strong><span>创建秘书，自动整理 Agent 进展。</span><button type="button" onClick={onCreate} style={styles.action}><Plus size={14} /> 新建秘书</button></div>
}

function toPresentation(projectId: string, thread: MobileSecretaryThread): FilesPresentationInfo {
  return { kind: 'files', presentationId: `secretary-${thread.id}`, projectId, title: thread.subject, createdAt: thread.updatedAt, files: thread.attachments.map((item) => ({ path: item.path, title: item.title ?? item.path.split('/').at(-1) ?? item.path, name: item.path.split('/').at(-1) ?? item.path, extension: item.path.includes('.') ? `.${item.path.split('.').at(-1)?.toLowerCase()}` : '', size: 0, kind: item.kind === 'image' || item.kind === 'audio' || item.kind === 'video' || item.kind === 'binary' ? item.kind : 'text', language: 'plaintext' })) }
}

function formatTime(value: string): string { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  header: { minHeight: 54, padding: '8px 10px 8px 14px', paddingTop: 'calc(8px + var(--safe-top))', display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  headerCopy: { minWidth: 0, flex: 1 },
  title: { margin: 0, fontSize: 18, color: 'var(--text-primary)' },
  subtitle: { color: 'var(--text-muted)', fontSize: 11 },
  iconButton: { width: 34, height: 34, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-primary)' },
  secretaryStrip: { display: 'flex', gap: 7, overflowX: 'auto', padding: '9px 12px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  secretaryButton: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', border: '1px solid var(--border-light)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: 12 },
  secretaryActive: { borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--primary-light)' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 3, padding: '8px 9px 8px 13px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' },
  secretaryMeta: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' },
  action: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, padding: '0 9px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12 },
  mailList: { flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--bg)' },
  mailRow: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 5, padding: '12px 14px', border: 0, borderBottom: '1px solid var(--border-light)', background: 'transparent', textAlign: 'left', color: 'var(--text-secondary)' },
  mailTitle: { display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-primary)', fontSize: 13 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)' },
  chatDot: { position: 'absolute', top: 5, right: 5, width: 6, height: 6, borderRadius: '50%', background: 'var(--error)' },
  summary: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' },
  detailHeader: { minHeight: 54, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', paddingTop: 'calc(8px + var(--safe-top))', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-light)' },
  detailHeading: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' },
  detailBody: { minHeight: 0, flex: 1, overflowY: 'auto', padding: 14, color: 'var(--text-secondary)', fontSize: 13 },
  summaryBox: { padding: 10, marginBottom: 14, borderLeft: '3px solid var(--primary)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12 },
  attachment: { display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 15, padding: '8px 10px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)' },
  notice: { padding: '6px 13px', color: 'var(--success)', background: 'var(--bg-card)', fontSize: 11 },
  mailHeading: { height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 },
  error: { margin: 10, padding: 9, borderRadius: 6, background: '#fff1f2', color: 'var(--error)', fontSize: 12 },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, color: 'var(--text-muted)', fontSize: 13 },
}
