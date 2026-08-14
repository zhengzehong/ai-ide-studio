import { useEffect, useMemo, useState } from 'react'
import { Archive, Bot, FileText, Mail, MessageSquare, Play, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useProjectScopeId } from '../hooks/use-project-scope'
import { useAgentStore } from '../stores/agent.store'
import { useSecretaryStore, type SecretaryData, type SecretaryThread } from '../stores/secretary.store'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { PresentedFilesModal } from '../components/file-viewer/PresentedFilesModal'
import type { FilesPresentationInfo } from '../stores/session-events'
import { SecretaryConfigModal } from './secretary/SecretaryConfigModal'
import { SecretaryChatPanel } from './secretary/SecretaryChatPanel'

export function Secretary() {
  const projectId = useProjectScopeId()
  const agents = useAgentStore((state) => state.agents)
  const fetchAgents = useAgentStore((state) => state.fetchAgents)
  const secretaries = useSecretaryStore((state) => state.secretaries)
  const selectedId = useSecretaryStore((state) => state.selectedId)
  const threads = useSecretaryStore((state) => state.threads)
  const loading = useSecretaryStore((state) => state.loading)
  const saving = useSecretaryStore((state) => state.saving)
  const error = useSecretaryStore((state) => state.error)
  const load = useSecretaryStore((state) => state.load)
  const select = useSecretaryStore((state) => state.select)
  const create = useSecretaryStore((state) => state.create)
  const update = useSecretaryStore((state) => state.update)
  const remove = useSecretaryStore((state) => state.remove)
  const runNow = useSecretaryStore((state) => state.runNow)
  const markRead = useSecretaryStore((state) => state.markRead)
  const archive = useSecretaryStore((state) => state.archive)
  const setupListeners = useSecretaryStore((state) => state.setupListeners)
  const [configOpen, setConfigOpen] = useState(false)
  const [editing, setEditing] = useState<SecretaryData | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [files, setFiles] = useState<FilesPresentationInfo | null>(null)
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    if (!projectId) return
    void fetchAgents(projectId)
    void load(projectId)
  }, [fetchAgents, load, projectId])

  useEffect(() => setupListeners(), [setupListeners])

  const selectedSecretary = useMemo(() => secretaries.find((item) => item.id === selectedId) ?? null, [secretaries, selectedId])
  const selectedThread = useMemo(() => threads.find((thread) => thread.id === selectedThreadId) ?? threads[0] ?? null, [selectedThreadId, threads])

  const chooseSecretary = (id: string): void => {
    if (!projectId) return
    setSelectedThreadId(null)
    void select(projectId, id)
  }

  const chooseThread = (thread: SecretaryThread): void => {
    setSelectedThreadId(thread.id)
    if (thread.unread && selectedSecretary) void markRead(selectedSecretary.id, thread.id)
  }

  const openChat = (): void => {
    if (selectedSecretary?.chatSessionId) setChatOpen(true)
  }

  const openFiles = (thread: SecretaryThread): void => {
    if (!projectId || thread.attachments.length === 0) return
    setFiles(toPresentation(projectId, thread))
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div><h1 style={styles.title}>项目秘书</h1><p style={styles.subtitle}>按项目观察 Agent，把结果整理成邮箱主题。</p></div>
        <div style={styles.actions}>
          <button type="button" title="刷新" aria-label="刷新" onClick={() => projectId && void load(projectId)} style={styles.iconButton}><RefreshCw size={15} /></button>
          {selectedSecretary && <button type="button" onClick={() => void runNow(selectedSecretary.id)} style={styles.actionButton}><Play size={14} /> 立即运行</button>}
          {selectedSecretary && <button type="button" onClick={openChat} style={styles.actionButton}><MessageSquare size={14} /> 秘书对话</button>}
          <button type="button" onClick={() => { setEditing(null); setConfigOpen(true) }} style={styles.primary}><Plus size={14} /> 新建秘书</button>
        </div>
      </header>
      {error && <div style={styles.error}>{error}</div>}
      {loading ? <div style={styles.empty}>正在加载秘书...</div> : secretaries.length === 0 ? <div style={styles.empty}><Mail size={26} /><strong>当前项目还没有秘书</strong><span>创建一个秘书，让它把 Agent 进展整理成邮件。</span><button type="button" onClick={() => setConfigOpen(true)} style={styles.primary}><Plus size={14} /> 创建第一个秘书</button></div> : (
        <main style={styles.workbench}>
          <aside style={styles.secretaryList}>
            <div style={styles.sectionTitle}>秘书 <span>{secretaries.length}</span></div>
            {secretaries.map((secretary) => {
              const count = secretary.unreadCount
              return <button type="button" key={secretary.id} onClick={() => chooseSecretary(secretary.id)} style={{ ...styles.secretaryRow, ...(secretary.id === selectedId ? styles.secretaryActive : {}) }}><span style={styles.avatar}><Bot size={15} /></span><span style={styles.secretaryCopy}><strong>{secretary.name}</strong><small>{secretary.enabled ? '运行中' : '已停用'} · {secretary.observeAll ? '观察全部 Agent' : `${secretary.observedAgentIds.length} 个观察 Agent`}</small></span>{count > 0 && <span style={styles.badge}>{count}</span>}</button>
            })}
          </aside>
          <section style={styles.mailList}>
            <div style={styles.sectionTitle}>{selectedSecretary?.name ?? '邮箱'} <span>{threads.length}</span></div>
            {threads.map((thread) => <button type="button" key={thread.id} onClick={() => chooseThread(thread)} style={{ ...styles.mailRow, ...(thread.id === selectedThread?.id ? styles.mailActive : {}), ...(thread.unread ? styles.mailUnread : {}) }}><span style={styles.mailTop}><strong>{thread.subject}</strong><time>{formatTime(thread.updatedAt)}</time></span><span style={styles.mailSummary}>{thread.summary || thread.bodyMarkdown.slice(0, 100)}</span><span style={styles.mailMeta}>{thread.needsAction ? '需要处理' : thread.kind} {thread.attachments.length > 0 ? ` · ${thread.attachments.length} 个附件` : ''}</span></button>)}
            {threads.length === 0 && <div style={styles.smallEmpty}>暂无邮件，秘书运行后会把有价值的结果放在这里。</div>}
          </section>
          <section style={styles.detail}>
            {selectedThread ? <>
              <header style={styles.detailHeader}><div><h2>{selectedThread.subject}</h2><small>{formatTime(selectedThread.updatedAt)} · {selectedThread.needsAction ? '需要处理' : '仅供查看'}</small></div><div style={styles.actions}><button type="button" title="编辑秘书" aria-label="编辑秘书" onClick={() => { setEditing(selectedSecretary); setConfigOpen(true) }} style={styles.iconButton}><Settings2 size={15} /></button><button type="button" title="归档" aria-label="归档" onClick={() => selectedSecretary && void archive(selectedSecretary.id, selectedThread.id)} style={styles.iconButton}><Archive size={15} /></button><button type="button" title="删除秘书" aria-label="删除秘书" onClick={() => { if (selectedSecretary && window.confirm(`确定删除秘书“${selectedSecretary.name}”？`)) void remove(selectedSecretary.id) }} style={styles.iconButton}><Trash2 size={15} /></button></div></header>
              <div style={styles.detailBody}><div style={styles.summary}><span>摘要</span><strong>{selectedThread.summary || '秘书未提供摘要'}</strong></div><MarkdownRenderer content={selectedThread.bodyMarkdown} projectId={projectId ?? undefined} />{selectedThread.attachments.length > 0 && <button type="button" onClick={() => openFiles(selectedThread)} style={styles.attachmentButton}><FileText size={14} /> 查看附件（{selectedThread.attachments.length}）</button>}</div>
            </> : <div style={styles.empty}>从邮件列表选择一封邮件</div>}
          </section>
        </main>
      )}
      {configOpen && <SecretaryConfigModal secretary={editing} agents={agents.filter((agent) => agent.project_id === projectId)} saving={saving} onClose={() => setConfigOpen(false)} onSave={async (input) => { if (editing) await update(editing.id, input); else await create(input); setConfigOpen(false) }} />}
      {files && <PresentedFilesModal presentation={files} onClose={() => setFiles(null)} />}
      {chatOpen && selectedSecretary?.chatSessionId && projectId && <SecretaryChatPanel projectId={projectId} secretaryId={selectedSecretary.id} sessionId={selectedSecretary.chatSessionId} onClose={() => setChatOpen(false)} />}
    </div>
  )
}

function toPresentation(projectId: string, thread: SecretaryThread): FilesPresentationInfo {
  return { kind: 'files', presentationId: `secretary-${thread.id}`, projectId, title: thread.subject, createdAt: thread.updatedAt, files: thread.attachments.map((file) => ({ path: file.path, title: file.title ?? file.path.split('/').at(-1) ?? file.path, name: file.path.split('/').at(-1) ?? file.path, extension: file.path.includes('.') ? `.${file.path.split('.').at(-1)?.toLowerCase()}` : '', size: 0, kind: fileKind(file.kind), language: 'plaintext' })) }
}

function fileKind(kind: string | undefined): 'text' | 'image' | 'audio' | 'video' | 'binary' {
  if (kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'binary') return kind
  return 'text'
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const styles: Record<string, React.CSSProperties> = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', padding: '22px 26px', overflow: 'hidden', background: 'var(--bg-1)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16, flexShrink: 0 },
  title: { margin: 0, fontSize: 19, color: 'var(--text-1)' },
  subtitle: { margin: '4px 0 0', color: 'var(--text-3)', fontSize: 12 },
  actions: { display: 'flex', alignItems: 'center', gap: 7 },
  iconButton: { width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-2)', cursor: 'pointer' },
  actionButton: { height: 30, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12 },
  primary: { height: 30, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 10px', border: 0, borderRadius: 6, background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 12 },
  error: { padding: 9, marginBottom: 10, borderRadius: 6, background: 'var(--red-light)', color: 'var(--red)', fontSize: 12 },
  workbench: { display: 'grid', gridTemplateColumns: '220px 310px minmax(0, 1fr)', minHeight: 0, flex: 1, border: '1px solid var(--border)', background: 'var(--bg-0)', borderRadius: 7, overflow: 'hidden' },
  secretaryList: { minWidth: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 8 },
  mailList: { minWidth: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' },
  sectionTitle: { height: 38, padding: '0 11px', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-2)', fontWeight: 700, fontSize: 12, borderBottom: '1px solid var(--border)' },
  secretaryRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 7px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-2)', textAlign: 'left', cursor: 'pointer' },
  secretaryActive: { background: 'var(--blue-light)', color: 'var(--blue)' },
  avatar: { width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'var(--bg-2)', flexShrink: 0 },
  secretaryCopy: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  badge: { minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: 'var(--blue)', color: '#fff', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  mailRow: { width: '100%', display: 'flex', flexDirection: 'column', gap: 5, padding: '11px 12px', border: 0, borderBottom: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-2)', textAlign: 'left', cursor: 'pointer' },
  mailActive: { background: 'var(--blue-light)' },
  mailUnread: { borderLeft: '3px solid var(--blue)', paddingLeft: 9 },
  mailTop: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 },
  mailSummary: { color: 'var(--text-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mailMeta: { color: 'var(--text-3)', fontSize: 10 },
  detail: { minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '16px 19px', borderBottom: '1px solid var(--border)' },
  detailBody: { minWidth: 0, overflowY: 'auto', padding: '18px 20px', color: 'var(--text-2)', fontSize: 13 },
  summary: { display: 'flex', flexDirection: 'column', gap: 5, padding: 10, marginBottom: 15, borderRadius: 6, background: 'var(--bg-1)', fontSize: 12 },
  attachmentButton: { marginTop: 16, height: 31, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-1)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12 },
  empty: { flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, color: 'var(--text-3)', fontSize: 13 },
  smallEmpty: { padding: 24, color: 'var(--text-3)', fontSize: 12, lineHeight: 1.6 },
}
