import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ChangeEvent, useMemo, type MouseEvent } from 'react'
import {
  Bot, ChevronDown, ChevronRight, Loader2, Plus, User, Wifi, WifiOff,
  Wrench, FileCode, Terminal, Check, X, Settings2, Square,
  ListTodo, CheckCircle2, Circle, Archive, Zap, Paperclip, ArrowUp,
  FolderOpen, MessageSquare as MessageSquareIcon,
} from 'lucide-react'
import { useAgentStore, type AgentData } from '../stores/agent.store'
import {
  useSessionStore,
  type ConfigOptionInfo,
  type ElicitationRequestInfo,
  type ImageAttachmentInfo,
  type PermissionRequestInfo,
  type PlanEntry,
  type ToolCallInfo,
} from '../stores/session.store'
import { useTaskStore, type TaskData } from '../stores/task.store'
import { useConnectionStore } from '../stores/connection.store'
import { useProjectStore } from '../stores/project.store'
import { useFileSystemStore } from '../stores/filesystem.store'
import { FileTree } from '../components/file-viewer/FileTree'
import { FilePreview } from '../components/file-viewer/FilePreview'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import { permissionOptionLabel, isAllowPermissionOption, isRejectAlwaysOption } from '../utils/permission'
import {
  getElicitationOptions,
  getInitialElicitationValues,
  validateElicitationValues,
  type ElicitationSchema,
  type ElicitationValue,
} from '../utils/elicitation-form'

const TYPE_COLORS: Record<string, string> = { dev: '#2563eb', test: '#059669', ops: '#ea580c', security: '#dc2626', architect: '#7c3aed', pm: '#7c3aed' }
function agentColor(a: AgentData): string { return TYPE_COLORS[a.type] ?? '#6b7280' }
function agentAvatar(a: AgentData): string { return a.name.charAt(0).toUpperCase() }
function statusDot(s: string): string { return s === 'running' ? '#2563eb' : s === 'idle' ? '#059669' : '#9ca3af' }
function statusLabel(s: string): string { return { running: '运行中', idle: '空闲', standby: '待机', sleeping: '休眠' }[s] ?? s }
function formatTime(iso: string): string { try { return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) } catch { return iso } }
function fmtTokens(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
const MODE_CN: Record<string, string> = {
  Default: '默认', Auto: '自动', 'Accept Edits': '自动编辑', 'Plan Mode': '计划模式',
  "Don't Ask": '不询问', 'Bypass Permissions': '跳过权限',
  default: '默认', plan: '计划', code: '编码', debug: '调试', ask: '提问', agent: '代理', edit: '编辑', chat: '对话',
}
function modeCn(name: string | null | undefined): string { return name ? (MODE_CN[name] || name) : '模式' }

function displayConfigValue(value: string | undefined): string {
  if (!value) return ''
  const labels: Record<string, string> = { default: '默认', low: '低', medium: '中', high: '高', xhigh: '超高', max: 'Max' }
  return labels[value] || value
}

function configOptionLabel(value: string, name: string): string {
  return displayConfigValue(value) || name
}

function configLabel(opt: ConfigOptionInfo): string {
  if (opt.category === 'thought_level') return configOptionLabel(String(opt.currentValue || ''), opt.name || '思考强度')
  if (opt.type === 'boolean') return `${opt.name}: ${opt.currentValue ? '开' : '关'}`
  const active = opt.options?.find(o => o.value === opt.currentValue)
  return active ? configOptionLabel(active.value, active.name) : opt.name
}

type MenuName = 'command' | 'mode' | 'model' | `config:${string}`
type MenuAnchor = { name: MenuName; left: number; top: number; minWidth: number }

function menuStyle(anchor: MenuAnchor | null, width = 260): React.CSSProperties {
  const fallbackTop = window.innerHeight - 440
  const left = Math.min(Math.max(8, anchor?.left ?? 280), window.innerWidth - width - 8)
  return { left, top: Math.max(8, anchor?.top ?? fallbackTop), width, maxWidth: `calc(100vw - 16px)` }
}

function toolSummary(tc: ToolCallInfo): string {
  const kindLabel = { read: '读取', edit: '编辑', delete: '删除', search: '搜索', execute: '执行', think: '思考', fetch: '拉取', move: '移动' }[tc.kind || ''] || ''
  const loc = tc.locations?.[0]
  if (loc) {
    return `${kindLabel || '访问'} ${loc.path}${loc.line ? `:${loc.line}` : ''}`
  }
  if (tc.rawInput && typeof tc.rawInput === 'object') {
    const inp = tc.rawInput as Record<string, unknown>
    if (inp.command) return `执行 ${String(inp.command).slice(0, 80)}`
    if (inp.path) return `${tc.kind === 'edit' ? '编辑' : '读取'} ${String(inp.path)}`
    if (inp.pattern) return `搜索 ${String(inp.pattern).slice(0, 60)}`
    if (inp.query) return `搜索 ${String(inp.query).slice(0, 60)}`
  }
  if (tc.title) return tc.title
  const hasDiff = tc.content?.some(c => c.type === 'diff')
  if (hasDiff) {
    const diffItem = tc.content!.find(c => c.type === 'diff')
    if (diffItem?.path) return `编辑 ${diffItem.path}`
  }
  if ((tc.content?.some(c => c.type === 'text' && c.text) || typeof tc.rawOutput === 'string') && tc.status === 'completed') return '工具调用 完成'
  return `工具调用 #${tc.id.slice(-6)}`
}

export default function Workspace() {
  const connected = useConnectionStore(s => s.connected)
  const agents = useAgentStore(s => s.agents)
  const sessions = useSessionStore(s => s.sessions)
  const currentSessionId = useSessionStore(s => s.currentSessionId)
  const messages = useSessionStore(s => s.messages)
  const streamingMessage = useSessionStore(s => s.streamingMessage)
  const usage = useSessionStore(s => s.usage)
  const capabilities = useSessionStore(s => s.capabilities)
  const plan = useSessionStore(s => s.plan)
  const selectSession = useSessionStore(s => s.selectSession)
  const sendPrompt = useSessionStore(s => s.sendPrompt)
  const createSession = useSessionStore(s => s.createSession)
  const fetchSessions = useSessionStore(s => s.fetchSessions)
  const setModel = useSessionStore(s => s.setModel)
  const setMode = useSessionStore(s => s.setMode)
  const setConfig = useSessionStore(s => s.setConfig)
  const cancelTurn = useSessionStore(s => s.cancelTurn)
  const pendingPermissions = useSessionStore(s => s.pendingPermissions)
  const pendingElicitations = useSessionStore(s => s.pendingElicitations)
  const respondPermission = useSessionStore(s => s.respondPermission)
  const respondElicitation = useSessionStore(s => s.respondElicitation)
  const tasks = useTaskStore(s => s.tasks)
  const createTask = useTaskStore(s => s.createTask)

  const currentProjectId = useProjectStore(s => s.currentProjectId)
  const fileTree = useFileSystemStore(s => s.tree)
  const openFile = useFileSystemStore(s => s.openFile)
  const fetchTree = useFileSystemStore(s => s.fetchTree)
  const expandDir = useFileSystemStore(s => s.expandDir)
  const openFileByPath = useFileSystemStore(s => s.openFileByPath)
  const closeFile = useFileSystemStore(s => s.closeFile)

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'files'>('sessions')
  const [expandedAgents, setExpandedAgents] = useState<Set<string> | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  useEffect(() => {
    if (currentProjectId && sidebarTab === 'files') fetchTree(currentProjectId)
  }, [currentProjectId, sidebarTab, fetchTree])
  const [inputValue, setInputValue] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)
  const [pendingImages, setPendingImages] = useState<{ data: string; mimeType: string; preview: string }[]>([])
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState<string | null>(null)
  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const prevMsgCount = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const expandedAgentIds = useMemo(() => expandedAgents ?? new Set(agents.map(a => a.id)), [agents, expandedAgents])
  const selectedAgent = useMemo(() => agents.find(a => a.id === selectedAgentId) ?? agents[0], [agents, selectedAgentId])
  const agentSessions = useCallback((id: string) => sessions.filter(s => s.agent_id === id), [sessions])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = chatScrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
    else chatEndRef.current?.scrollIntoView({ behavior })
  }, [])

  const streamingScrollSignature = useMemo(() => {
    if (!streamingMessage) return ''
    return JSON.stringify([
      streamingMessage.content.length,
      streamingMessage.thinking.length,
      streamingMessage.toolCalls.length,
      streamingMessage.toolCalls.map(t => [t.id, t.status, t.terminalOutput?.length, t.progress?.length, t.rawOutput != null]),
    ])
  }, [streamingMessage])
  const shouldScrollStreaming = !!streamingMessage && !streamingMessage.done

  useEffect(() => { if (messages.length !== prevMsgCount.current) { prevMsgCount.current = messages.length; requestAnimationFrame(() => scrollToBottom('smooth')) } }, [messages.length, scrollToBottom])
  useEffect(() => {
    if (shouldScrollStreaming) {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      requestAnimationFrame(() => scrollToBottom('auto'))
      scrollTimerRef.current = setTimeout(() => scrollToBottom('auto'), 40)
    }
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current) }
  }, [shouldScrollStreaming, streamingScrollSignature, scrollToBottom])

  const autoResize = () => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }
  }

  const toggleAgent = (id: string) => setExpandedAgents(p => {
    const n = new Set(p ?? agents.map(a => a.id))
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const handleSelectSession = (agentId: string, sessionId: string) => { setSelectedAgentId(agentId); selectSession(sessionId) }
  const handleNewSession = async (agentId: string) => { const s = await createSession(agentId); setSelectedAgentId(agentId); selectSession(s.id); await fetchSessions() }

  const handleSend = () => {
    const v = inputValue.trim(); if (!v || !currentSessionId) return
    sendPrompt(v, pendingImages.length > 0 ? pendingImages.map(i => ({ data: i.data, mimeType: i.mimeType })) : undefined)
    setInputValue(''); setPendingImages([])
    requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.focus() } })
  }
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = () => setPendingImages(prev => [...prev, { data: (reader.result as string).split(',')[1], mimeType: file.type, preview: URL.createObjectURL(file) }])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const openMenu = (name: MenuName, e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const nextAnchor = { name, left: rect.left, top: rect.top - 8, minWidth: rect.width }
    setMenuAnchor(nextAnchor)
    setShowCommandMenu(name === 'command' ? !showCommandMenu : false)
    setShowModeMenu(name === 'mode' ? !showModeMenu : false)
    setShowModelMenu(name === 'model' ? !showModelMenu : false)
    setShowConfigMenu(name.startsWith('config:') ? (showConfigMenu === name.slice(7) ? null : name.slice(7)) : null)
  }

  const blockingInteraction = pendingPermissions.length > 0 || pendingElicitations.length > 0
  const pendingInteractionId = pendingPermissions[0]?.id || pendingElicitations[0]?.id || ''
  const isStreaming = !!(streamingMessage && !streamingMessage.done)
  const streamingBubble = isStreaming ? { id: streamingMessage!.id, role: 'agent' as const, content: streamingMessage!.content, thinking: streamingMessage!.thinking, toolCalls: streamingMessage!.toolCalls, timestamp: new Date().toISOString(), streaming: true as const } : null
  const interactionPanel = blockingInteraction ? (
    <InteractionPanel
      permission={pendingPermissions[0]}
      elicitation={pendingPermissions.length === 0 ? pendingElicitations[0] : undefined}
      onRespondPermission={respondPermission}
      onRespondElicitation={respondElicitation}
    />
  ) : null

  const currentModeName = capabilities.modes.find(m => m.modeId === capabilities.currentModeId)?.name || capabilities.currentModeId
  const currentModelName = capabilities.models.find(m => m.modelId === capabilities.currentModelId)?.name || capabilities.currentModelId
  const secondaryConfigs = capabilities.configOptions.filter(o => o.category !== 'model' && o.category !== 'mode' && o.id !== 'model' && o.id !== 'mode')

  useEffect(() => {
    if (blockingInteraction) requestAnimationFrame(() => scrollToBottom('smooth'))
  }, [blockingInteraction, pendingInteractionId, scrollToBottom])

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-1)' }}>
      {/* ─── Left Sidebar ─── */}
      <aside style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg-0)' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button type="button" onClick={() => setSidebarTab('sessions')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 0', border: 'none', borderBottom: sidebarTab === 'sessions' ? '2px solid var(--blue)' : '2px solid transparent', background: 'transparent', color: sidebarTab === 'sessions' ? 'var(--blue)' : 'var(--text-3)', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s' }}>
            <MessageSquareIcon size={14} /> 会话
          </button>
          <button type="button" onClick={() => setSidebarTab('files')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 0', border: 'none', borderBottom: sidebarTab === 'files' ? '2px solid var(--blue)' : '2px solid transparent', background: 'transparent', color: sidebarTab === 'files' ? 'var(--blue)' : 'var(--text-3)', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s' }}>
            <FolderOpen size={14} /> 文件
          </button>
        </div>

        {sidebarTab === 'sessions' ? (
          <>
            <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {connected ? <Wifi size={12} color="var(--green)" /> : <WifiOff size={12} color="var(--red)" />}
              <span style={{ fontSize: 11, color: connected ? 'var(--green)' : 'var(--red)' }}>{connected ? '已连接' : '未连接'}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
              <div style={{ padding: '6px 14px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.04em' }}>智能体</div>
              {agents.map(agent => (
                <div key={agent.id} style={{ marginBottom: 2 }}>
                  <button type="button" onClick={() => toggleAgent(agent.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 14px', border: 'none', background: 'transparent', color: 'var(--text-1)', cursor: 'pointer', textAlign: 'left' }}>
                    {expandedAgentIds.has(agent.id) ? <ChevronDown size={13} color="var(--text-3)" /> : <ChevronRight size={13} color="var(--text-3)" />}
                    <span style={{ width: 24, height: 24, borderRadius: '50%', background: agentColor(agent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0 }}>{agentAvatar(agent)}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{agent.name}</span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: 'var(--bg-2)', color: 'var(--text-3)' }}>{agentSessions(agent.id).length}</span>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot(agent.status), flexShrink: 0 }} title={statusLabel(agent.status)} />
                  </button>
                  {expandedAgentIds.has(agent.id) && (<>
                    {agentSessions(agent.id).map(s => (
                      <button key={s.id} type="button" onClick={() => handleSelectSession(agent.id, s.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 14px 5px 42px', border: 'none', background: currentSessionId === s.id ? 'var(--blue-light)' : 'transparent', color: 'var(--text-1)', cursor: 'pointer', textAlign: 'left', borderRadius: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.status === 'active' ? '#059669' : '#9ca3af', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>会话 {s.id.slice(-6)}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{formatTime(s.started_at)}</span>
                      </button>
                    ))}
                    <button type="button" onClick={() => handleNewSession(agent.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 14px 5px 42px', border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 11 }}><Plus size={12} /> 新建会话</button>
                  </>)}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', minHeight: 0 }}>
            {!currentProjectId ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                <FolderOpen size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>请先在顶部选择一个项目</p>
              </div>
            ) : fileTree.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                <FolderOpen size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>加载文件中...</p>
              </div>
            ) : (
              <FileTree
                entries={fileTree}
                selectedPath={openFile?.path ?? null}
                onSelectFile={(path) => currentProjectId && openFileByPath(currentProjectId, path)}
                onExpandDir={(path) => currentProjectId && expandDir(currentProjectId, path)}
              />
            )}
          </div>
        )}
      </aside>

      {/* ─── File Preview (optional) ─── */}
      {openFile && (
        <div style={{ width: 420, flexShrink: 0 }}>
          <FilePreview file={openFile} onClose={closeFile} />
        </div>
      )}

      {/* ─── Center Chat ─── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <header style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-0)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {selectedAgent && (<>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: agentColor(selectedAgent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white' }}>{agentAvatar(selectedAgent)}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedAgent.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{selectedAgent.runtime} · {statusLabel(selectedAgent.status)}</div>
              </div>
            </>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
        </header>

        {(plan.length > 0 || capabilities.currentModeId === 'plan') && (
          <PlanBar plan={plan} currentModeId={capabilities.currentModeId} modes={capabilities.modes} onSetMode={setMode} />
        )}

        {/* Messages */}
        <div ref={chatScrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!currentSessionId ? (
            <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '80px 20px' }}>
              <Bot size={48} color="var(--text-3)" style={{ marginBottom: 16, opacity: 0.3 }} />
              <div style={{ fontSize: 15, marginBottom: 8 }}>选择一个 Session 或新建会话</div>
              <div style={{ fontSize: 12 }}>点击左侧 Agent 下方的会话开始</div>
            </div>
          ) : (
            <div style={{ padding: '20px 20px 100px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {messages.length === 0 && !streamingBubble && !blockingInteraction && <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '48px 0' }}>暂无消息，开始对话吧</div>}
              {messages.map(msg => <ChatBubble key={msg.id} message={msg} agent={selectedAgent} isStreaming={false} />)}
              {streamingBubble && <ChatBubble key="streaming" message={streamingBubble} agent={selectedAgent} isStreaming footer={interactionPanel} />}
              {blockingInteraction && !streamingBubble && (
                <BlockingInteractionBar
                  agent={selectedAgent}
                  panel={interactionPanel}
                />
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* ─── Codex-style Input Card ─── */}
        <div style={{ padding: '0 20px 16px', flexShrink: 0 }}>
          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {pendingImages.map((img, i) => (
                <div key={i} style={{ position: 'relative', width: 52, height: 52, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <img src={img.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button type="button" onClick={() => setPendingImages(p => p.filter((_, j) => j !== i))} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><X size={10} /></button>
                </div>
              ))}
            </div>
          )}

          <div style={{
            border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-0)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden',
            opacity: currentSessionId ? 1 : 0.5,
          }}>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => { setInputValue(e.target.value); autoResize() }}
              onKeyDown={handleKeyDown}
              placeholder={blockingInteraction ? '等待你确认后继续...' : (currentSessionId ? '输入消息...' : '先选择一个 Session')}
              disabled={!currentSessionId || !connected || blockingInteraction}
              autoFocus
              rows={2}
              style={{
                width: '100%', padding: '14px 16px 8px', border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', color: 'var(--text-1)', fontSize: 13, lineHeight: 1.6,
                fontFamily: 'inherit', minHeight: 56, maxHeight: 160, boxSizing: 'border-box',
              }}
            />
            {/* Bottom toolbar (inside the card) */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 10px', gap: 4 }}>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!currentSessionId} title="添加附件"
                style={{ width: 30, height: 30, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Paperclip size={15} />
              </button>

              {capabilities.commands.length > 0 && (
                <button type="button" onClick={e => openMenu('command', e)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                  <Wrench size={12} /> 命令 <ChevronDown size={10} />
                </button>
              )}

              {capabilities.modes.length > 0 && (
                <button type="button" onClick={e => openMenu('mode', e)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                  <Settings2 size={12} /> {modeCn(currentModeName)} <ChevronDown size={10} />
                </button>
              )}

              <div style={{ flex: 1 }} />

              {secondaryConfigs.map(opt => (
                <button key={opt.id} type="button" onClick={e => openMenu(`config:${opt.id}`, e)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                  {configLabel(opt)} <ChevronDown size={10} />
                </button>
              ))}

              {usage && <MiniContextCircle used={usage.contextUsed} total={usage.contextSize} />}

              {capabilities.models.length > 0 && (
                <button type="button" onClick={e => openMenu('model', e)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                  {currentModelName || '模型'} <ChevronDown size={10} />
                </button>
              )}

              {blockingInteraction && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginRight: 6 }}>等待确认</span>}

              {isStreaming ? (
                <button type="button" onClick={cancelTurn} title="停止生成"
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--red)', cursor: 'pointer',
                    background: 'transparent', color: 'var(--red)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
                  }}>
                  <Square size={14} fill="var(--red)" />
                </button>
              ) : (
                <button type="button" onClick={handleSend} disabled={!currentSessionId || !connected || blockingInteraction || !inputValue.trim()}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: currentSessionId && !blockingInteraction && inputValue.trim() ? 'pointer' : 'default',
                    background: currentSessionId && !blockingInteraction && inputValue.trim() ? 'var(--text-1)' : 'var(--bg-3)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s',
                  }}>
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ─── Right Sidebar — Task Panel ─── */}
      <aside style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', background: 'var(--bg-0)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ListTodo size={14} /> 任务</div>
          <button type="button" onClick={() => setShowNewTask(true)} style={{ border: 'none', background: 'var(--blue)', color: 'white', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={12} /> 新建</button>
        </div>
        <TaskPanel tasks={tasks} agents={agents} />
      </aside>

      {showNewTask && <NewTaskModal agents={agents} onCreate={createTask} onClose={() => setShowNewTask(false)} />}

      {/* 命令菜单 */}
      {showCommandMenu && <DropdownPortal onClose={() => setShowCommandMenu(false)} style={menuStyle(menuAnchor, 320)}>
        {capabilities.commands.map(cmd => (
          <button key={cmd.name} type="button" onClick={() => { setInputValue(`/${cmd.name} `); setShowCommandMenu(false); textareaRef.current?.focus() }} style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', minWidth: 0, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}>
            <span style={{ fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/{cmd.name}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 10, whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.4 }}>{cmd.description || cmd.input?.hint || '插入命令'}</span>
          </button>
        ))}
      </DropdownPortal>}

      {/* 模式菜单 */}
      {showModeMenu && <DropdownPortal onClose={() => setShowModeMenu(false)} style={menuStyle(menuAnchor, 260)}>
        {capabilities.modes.map(m => {
          const active = m.modeId === capabilities.currentModeId
          return <button key={m.modeId} type="button" onClick={() => { setMode(m.modeId); setShowModeMenu(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', borderRadius: 8, background: active ? 'var(--blue-light)' : 'transparent', color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
            {active ? <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} /> : <Circle size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{modeCn(m.name)}</div>{m.description && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{m.description}</div>}</div>
          </button>
        })}
      </DropdownPortal>}

      {/* 配置菜单 */}
      {showConfigMenu && <DropdownPortal onClose={() => setShowConfigMenu(null)} style={menuStyle(menuAnchor, 240)}>
        {(() => {
          const opt = secondaryConfigs.find(o => o.id === showConfigMenu)
          if (!opt) return null
          if (opt.type === 'boolean') {
            const active = opt.currentValue === true
            return <button type="button" onClick={() => { setConfig(opt.id, !active); setShowConfigMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', borderRadius: 8, background: active ? 'var(--blue-light)' : 'transparent', color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>{active ? <Check size={13} color="var(--blue)" /> : <Circle size={13} color="var(--text-3)" />} {opt.name}</button>
          }
          return opt.options?.map(item => {
            const active = item.value === opt.currentValue
            return <button key={item.value} type="button" onClick={() => { setConfig(opt.id, item.value); setShowConfigMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', borderRadius: 8, background: active ? 'var(--blue-light)' : 'transparent', color: 'var(--text-1)', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}>
              {active ? <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} /> : <Circle size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{configOptionLabel(item.value, item.name)}</div>{item.description && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{item.description}</div>}</div>
            </button>
          })
        })()}
      </DropdownPortal>}

      {/* 模型菜单 */}
      {showModelMenu && <DropdownPortal onClose={() => setShowModelMenu(false)} style={menuStyle(menuAnchor, 280)}>
        {capabilities.models.map(m => {
          const active = m.modelId === capabilities.currentModelId
          return <button key={m.modelId} type="button" onClick={() => { setModel(m.modelId); setShowModelMenu(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', borderRadius: 8, background: active ? 'var(--blue-light)' : 'transparent', color: 'var(--text-1)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
            {active ? <Check size={13} color="var(--blue)" style={{ flexShrink: 0 }} /> : <Circle size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />}
            <span style={{ fontWeight: active ? 600 : 400 }}>{m.name || m.modelId}</span>
          </button>
        })}
      </DropdownPortal>}
    </div>
  )
}

/* ─── Mini Context Circle (input toolbar) ─── */
function MiniContextCircle({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, (used / total) * 100)
  const r = 7, c = 2 * Math.PI * r, dash = c * pct / 100
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? '#f59e0b' : 'var(--blue)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={`上下文: ${fmtTokens(used)} / ${fmtTokens(total)}`}>
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--bg-3)" strokeWidth="2" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={c * 0.25} strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{fmtTokens(used)}/{fmtTokens(total)}</span>
    </div>
  )
}

/* ─── Plan Bar ─── */
function PlanBar({ plan, currentModeId, modes, onSetMode }: { plan: PlanEntry[]; currentModeId: string | null; modes: { modeId: string; name: string; description?: string }[]; onSetMode: (modeId: string) => Promise<void> }) {
  const [open, setOpen] = useState(true)
  const done = plan.filter(p => p.status === 'completed').length
  const isPlanMode = currentModeId === 'plan' || modes.find(m => m.modeId === currentModeId)?.name === 'Plan Mode'
  const defaultMode = modes.find(m => m.modeId === 'default' || m.name === 'Default')?.modeId || modes.find(m => m.modeId !== currentModeId)?.modeId
  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-0)' }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ width: '100%', padding: '8px 20px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'left' }}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ListTodo size={13} color="var(--blue)" /> 计划 ({done}/{plan.length})
        {isPlanMode && <span style={{ marginLeft: 6, padding: '2px 7px', borderRadius: 999, background: 'var(--blue-light)', color: 'var(--blue)', fontSize: 11, fontWeight: 600 }}>PLAN 模式</span>}
        {isPlanMode && defaultMode && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); void onSetMode(defaultMode) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); void onSetMode(defaultMode) } }}
            style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 7, background: 'var(--text-1)', color: 'white', fontSize: 11, fontWeight: 600 }}
          >切换到执行模式</span>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 20px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {plan.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>计划模式已开启，Agent 会先给出计划；如需执行可切换到执行模式。</div>}
          {plan.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: p.status === 'completed' ? 'var(--green)' : p.status === 'in_progress' ? 'var(--blue)' : 'var(--text-3)' }}>
              {p.status === 'completed' ? <CheckCircle2 size={12} /> : p.status === 'in_progress' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Circle size={12} />}
              <span style={{ textDecoration: p.status === 'completed' ? 'line-through' : undefined }}>{p.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Task Panel with Tabs ─── */
const TASK_TABS: { key: string; label: string; icon: typeof ListTodo; filter: (t: TaskData) => boolean }[] = [
  { key: 'all', label: '全部', icon: ListTodo, filter: () => true },
  { key: 'backlog', label: '待办', icon: Circle, filter: t => t.status === 'backlog' },
  { key: 'active', label: '进行中', icon: Loader2, filter: t => ['executing', 'planning', 'reviewing'].includes(t.status) },
  { key: 'blocked', label: '需处理', icon: Zap, filter: t => t.status === 'blocked' },
  { key: 'done', label: '已完成', icon: CheckCircle2, filter: t => ['completed', 'cancelled'].includes(t.status) },
]

function taskStageLabel(s: string): string { return { executing: '执行中', planning: '规划中', reviewing: '审查中', blocked: '已阻塞', completed: '已完成', backlog: '待办', cancelled: '已取消' }[s] ?? s }
function taskStageColor(s: string): string { return { executing: 'var(--blue)', planning: 'var(--purple)', reviewing: '#f59e0b', blocked: 'var(--red)', completed: 'var(--green)', backlog: 'var(--text-3)' }[s] ?? 'var(--text-3)' }

function TaskPanel({ tasks, agents }: { tasks: TaskData[]; agents: AgentData[] }) {
  const [tab, setTab] = useState('all')
  const filtered = tasks.filter(TASK_TABS.find(t => t.key === tab)!.filter)
  const agentMap = new Map(agents.map(a => [a.id, a]))

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Tabs — 重新设计为 pill 样式 */}
      <div style={{ display: 'flex', gap: 4, padding: '10px 12px 6px', flexWrap: 'wrap' }}>
        {TASK_TABS.map(t => {
          const count = tasks.filter(t.filter).length
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 10px', borderRadius: 16,
              border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
              background: active ? 'var(--blue-light)' : 'var(--bg-1)',
              color: active ? 'var(--blue)' : 'var(--text-3)',
              fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
            }}>
              <Icon size={11} />
              {t.label}
              {count > 0 && <span style={{ background: active ? 'var(--blue)' : 'var(--bg-3)', color: active ? 'white' : 'var(--text-2)', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 16, textAlign: 'center' }}>{count}</span>}
            </button>
          )
        })}
      </div>
      {/* Task list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 12px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 12px', color: 'var(--text-3)' }}>
            <Archive size={28} style={{ opacity: 0.2, marginBottom: 8 }} />
            <div style={{ fontSize: 12 }}>暂无{TASK_TABS.find(t => t.key === tab)?.label}任务</div>
          </div>
        ) : filtered.map(task => {
          const ag = task.assigned_agent_id ? agentMap.get(task.assigned_agent_id) : null
          return (
            <div key={task.id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', marginBottom: 6, transition: 'box-shadow 0.15s' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, lineHeight: 1.4, color: 'var(--text-1)' }}>{task.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: 'white', fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: taskStageColor(task.status) }}>{task.stage || taskStageLabel(task.status)}</span>
                {ag && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: agentColor(ag), color: 'white', fontWeight: 500 }}>{ag.name}</span>}
                <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 'auto' }}>{formatTime(task.created_at)}</span>
              </div>
              {task.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.description}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Tool Call Panel ─── */
function ToolCallPanel({ tc }: { tc: ToolCallInfo; isStreaming: boolean }) {
  const isActive = tc.status === 'in_progress' || tc.status === 'pending'
  const [openOverride, setOpenOverride] = useState<'open' | 'closed' | null>(null)
  const prevStatusRef = useRef(tc.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = tc.status
    if ((prev === 'in_progress' || prev === 'pending') && tc.status === 'completed') {
      setOpenOverride(cur => cur === 'open' ? 'open' : 'closed')
    }
  }, [tc.status])
  const open = openOverride === 'open' || (openOverride !== 'closed' && isActive)
  const toggleOpen = () => setOpenOverride(open ? 'closed' : 'open')
  const kindIcon = tc.kind === 'edit' ? <FileCode size={12} /> : tc.kind === 'execute' ? <Terminal size={12} /> : <Wrench size={12} />
  const statusColor = tc.status === 'completed' ? 'var(--green)' : tc.status === 'failed' ? 'var(--red)' : 'var(--blue)'
  const statusIcon = tc.status === 'completed' ? <Check size={10} /> : tc.status === 'failed' ? <X size={10} /> : <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
  const statusText = tc.status === 'completed' ? '完成' : tc.status === 'failed' ? '失败' : tc.status === 'in_progress' ? '执行中' : '等待'
  const summary = toolSummary(tc)

  return (
    <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-1)', maxWidth: '100%' }}>
      <button type="button" onClick={toggleOpen} style={{ width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', fontSize: 12, color: 'var(--text-1)' }}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {kindIcon}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{summary}</span>
        <span style={{ color: statusColor, display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, flexShrink: 0, fontWeight: 500 }}>{statusIcon} {statusText}</span>
      </button>
      {open && (
        <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 11, minWidth: 0, overflowX: 'hidden' }}>
          {tc.locations && tc.locations.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {tc.locations.map((l, i) => <span key={i} style={{ display: 'inline-block', maxWidth: '100%', padding: '2px 8px', borderRadius: 4, background: 'var(--bg-2)', fontSize: 10, marginRight: 4, color: 'var(--text-2)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}>{l.path}{l.line ? `:${l.line}` : ''}</span>)}
            </div>
          )}
          {tc.rawInput != null && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>参数</div>
              <div style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre', maxHeight: 120, maxWidth: '100%', overflow: 'auto', color: 'var(--text-2)', lineHeight: 1.5 }}>
                {typeof tc.rawInput === 'string' ? tc.rawInput.slice(0, 500) : JSON.stringify(tc.rawInput, null, 2).slice(0, 500)}
              </div>
            </div>
          )}
          {tc.content?.map((c, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              {c.type === 'diff' && c.path && <div style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre', maxHeight: 200, maxWidth: '100%', overflow: 'auto', lineHeight: 1.5 }}><div style={{ color: 'var(--text-3)', marginBottom: 3 }}>{c.path}</div>{c.oldText && <div style={{ color: 'var(--red)' }}>- {c.oldText.slice(0, 200)}</div>}{c.newText && <div style={{ color: 'var(--green)' }}>+ {c.newText.slice(0, 200)}</div>}</div>}
              {c.type === 'text' && c.text && <div style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontSize: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 150, maxWidth: '100%', overflow: 'auto', color: 'var(--text-2)', lineHeight: 1.5 }}>{c.text.slice(0, 500)}</div>}
            </div>
          ))}
          {tc.terminalOutput && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>终端输出</div><div style={{ background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre', maxHeight: 160, maxWidth: '100%', overflow: 'auto', lineHeight: 1.5 }}>{tc.terminalOutput.slice(-2000)}</div></div>}
          {tc.progress && tc.progress.length > 0 && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>进度</div><div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{tc.progress.slice(-6).map((p, i) => <div key={i} style={{ fontSize: 10, color: 'var(--text-2)' }}>• {p}</div>)}</div></div>}
          {tc.rawOutput != null && <div style={{ marginTop: 6 }}><div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>结果</div><div style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre', maxHeight: 120, maxWidth: '100%', overflow: 'auto', color: 'var(--text-2)', lineHeight: 1.5 }}>{typeof tc.rawOutput === 'string' ? tc.rawOutput.slice(0, 500) : JSON.stringify(tc.rawOutput, null, 2).slice(0, 500)}</div></div>}
        </div>
      )}
    </div>
  )
}


function BlockingInteractionBar({ agent, panel }: {
  agent: AgentData | undefined
  panel: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: agent ? agentColor(agent) : 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Bot size={14} color="white" />
      </div>
      <div style={{ width: 'min(760px, 75%)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{agent?.name || 'Agent'}</span>
          <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700 }}>等待确认</span>
        </div>
        {panel}
      </div>
    </div>
  )
}

function InteractionPanel({ permission, elicitation, onRespondPermission, onRespondElicitation }: {
  permission?: PermissionRequestInfo
  elicitation?: ElicitationRequestInfo
  onRespondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  onRespondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void>
}) {
  return (<>
    {permission && <PermissionCard request={permission} onRespond={onRespondPermission} />}
    {!permission && elicitation && <ElicitationCard request={elicitation} onRespond={onRespondElicitation} />}
  </>)
}

function PermissionCard({ request, onRespond }: { request: PermissionRequestInfo; onRespond: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false)
  const respond = async (optionId?: string, cancelled?: boolean) => {
    if (submitting) return
    setSubmitting(true)
    try { await onRespond(request.id, optionId, cancelled) } finally { setSubmitting(false) }
  }

  return (
    <div style={{ border: '1px solid rgba(37,99,235,0.25)', borderRadius: '2px 12px 12px 12px', background: 'var(--bg-0)', boxShadow: 'var(--shadow-sm)', padding: 14, maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--blue-light)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Wrench size={16} /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>需要确认工具调用</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>Agent 正在等待你的权限决定，确认前本轮会暂停。</div>
        </div>
        <span style={{ padding: '3px 8px', borderRadius: 999, background: '#fef2f2', color: 'var(--red)', fontSize: 11, fontWeight: 700 }}>阻塞中</span>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', marginBottom: 10 }}><ToolCallPanel tc={request.toolCall} isStreaming={false} /></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {request.options.map(opt => {
          const allow = isAllowPermissionOption(opt)
          const rejectAlways = isRejectAlwaysOption(opt)
          return <button key={opt.optionId} type="button" disabled={submitting} title={opt.name} onClick={() => respond(opt.optionId)} style={{ padding: '8px 13px', borderRadius: 8, border: allow ? 'none' : '1px solid var(--border)', background: allow ? 'var(--blue)' : (rejectAlways ? '#fef2f2' : 'var(--bg-1)'), color: allow ? 'white' : (rejectAlways ? 'var(--red)' : 'var(--text-2)'), fontSize: 12, fontWeight: 600, cursor: submitting ? 'default' : 'pointer' }}>{permissionOptionLabel(opt)}</button>
        })}
        <button type="button" disabled={submitting} onClick={() => respond(undefined, true)} style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: submitting ? 'default' : 'pointer' }}>取消本次</button>
      </div>
    </div>
  )
}

function ElicitationCard({ request, onRespond }: { request: ElicitationRequestInfo; onRespond: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, string | number | boolean | string[]>) => Promise<void> }) {
  const schema = request.requestedSchema as ElicitationSchema | undefined
  const props = schema?.properties || {}
  const [values, setValues] = useState<Record<string, ElicitationValue>>(() => getInitialElicitationValues(schema))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setValues(getInitialElicitationValues(schema))
    setErrors({})
  }, [request.id, schema])

  const submit = async () => {
    const validation = validateElicitationValues(schema, values)
    setErrors(validation.errors)
    if (!validation.ok || submitting) return
    setSubmitting(true)
    try { await onRespond(request.id, 'accept', values) } finally { setSubmitting(false) }
  }
  const respond = async (action: 'decline' | 'cancel') => {
    if (submitting) return
    setSubmitting(true)
    try { await onRespond(request.id, action) } finally { setSubmitting(false) }
  }

  if (schema?.url) {
    return (
      <div style={{ border: '1px solid rgba(37,99,235,0.25)', borderRadius: '2px 12px 12px 12px', background: 'var(--bg-0)', boxShadow: 'var(--shadow-sm)', padding: 14, maxWidth: '100%', overflow: 'hidden' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Agent 请求你打开页面</div>
        {request.message && <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.5 }}>{request.message}</div>}
        <a href={schema.url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 12, color: 'var(--blue)', overflowWrap: 'anywhere', marginBottom: 12 }}>{schema.url}</a>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" disabled={submitting} onClick={submit} style={{ padding: '8px 13px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>我已完成</button>
          <button type="button" disabled={submitting} onClick={() => respond('cancel')} style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>取消</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid rgba(37,99,235,0.25)', borderRadius: '2px 12px 12px 12px', background: 'var(--bg-0)', boxShadow: 'var(--shadow-sm)', padding: 14, maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--blue-light)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MessageSquareIcon size={16} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Agent 提问</div>
          {request.message && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{request.message}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 320, overflow: 'auto', paddingRight: 2 }}>
        {Object.entries(props).map(([key, prop]) => {
          const options = getElicitationOptions(prop)
          const label = prop.title || key
          const required = schema?.required?.includes(key)
          return (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--text-3)' }}>
              <span style={{ fontWeight: 600 }}>{label}{required && <span style={{ color: 'var(--red)' }}> *</span>}</span>
              {prop.description && <span style={{ fontSize: 10, lineHeight: 1.4 }}>{prop.description}</span>}
              {prop.type === 'boolean' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', fontSize: 12 }}><input type="checkbox" checked={values[key] === true} onChange={e => setValues(v => ({ ...v, [key]: e.target.checked }))} /> 是</span>
              ) : prop.type === 'array' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {options.map(item => {
                    const selected = Array.isArray(values[key]) && (values[key] as string[]).includes(item.value)
                    return <button key={item.value} type="button" onClick={() => setValues(v => {
                      const cur = Array.isArray(v[key]) ? v[key] as string[] : []
                      return { ...v, [key]: selected ? cur.filter(x => x !== item.value) : [...cur, item.value] }
                    })} style={{ padding: '6px 9px', borderRadius: 999, border: selected ? '1px solid var(--blue)' : '1px solid var(--border)', background: selected ? 'var(--blue-light)' : 'var(--bg-1)', color: selected ? 'var(--blue)' : 'var(--text-2)', fontSize: 12, cursor: 'pointer' }}>{item.label}</button>
                  })}
                </div>
              ) : options.length > 0 ? (
                <select value={String(values[key] ?? '')} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-1)' }}>
                  <option value="">请选择</option>
                  {options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              ) : (
                <input type={prop.type === 'number' || prop.type === 'integer' ? 'number' : 'text'} value={String(values[key] ?? '')} onChange={e => setValues(v => ({ ...v, [key]: prop.type === 'number' || prop.type === 'integer' ? Number(e.target.value) : e.target.value }))} style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-1)' }} />
              )}
              {errors[key] && <span style={{ color: 'var(--red)', fontSize: 10 }}>{errors[key]}</span>}
            </label>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" disabled={submitting} onClick={submit} style={{ padding: '8px 13px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>提交</button>
        <button type="button" disabled={submitting} onClick={() => respond('decline')} style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>拒绝</button>
        <button type="button" disabled={submitting} onClick={() => respond('cancel')} style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>取消</button>
      </div>
    </div>
  )
}


/* ─── Chat Bubble ─── */
type ChatMsg = { id: string; role: string; content: string; thinking?: string | null; tool_calls_json?: string | null; decision_json?: string | null; attachments_json?: string | null; toolCalls?: ToolCallInfo[]; timestamp?: string; streaming?: boolean }

interface TurnStats { inputTokens: number; outputTokens: number; totalTokens: number; cachedReadTokens?: number; thoughtTokens?: number; costAmount?: number; elapsedSeconds?: number }
const statChipStyle: React.CSSProperties = { padding: '3px 8px', borderRight: '1px solid var(--border)', fontSize: 10, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }

function ChatBubble({ message, agent, isStreaming, footer }: { message: ChatMsg; agent: AgentData | undefined; isStreaming: boolean; footer?: React.ReactNode }) {
  const defaultThinkingOpen = !!(isStreaming && message.thinking)
  const [thinkingOpenOverride, setThinkingOpenOverride] = useState<'open' | 'closed' | null>(null)
  const thinkingOpen = thinkingOpenOverride === 'open' || (thinkingOpenOverride !== 'closed' && defaultThinkingOpen)
  const toggleThinkingOpen = () => setThinkingOpenOverride(thinkingOpen ? 'closed' : (defaultThinkingOpen ? null : 'open'))
  const isHuman = message.role === 'human'
  const toolCalls: ToolCallInfo[] = message.toolCalls || (message.tool_calls_json ? (() => { try { return JSON.parse(message.tool_calls_json) } catch { return [] } })() : [])
  const turnStats: TurnStats | null = !isHuman && message.decision_json ? (() => { try { return JSON.parse(message.decision_json) } catch { return null } })() : null
  const attachments: ImageAttachmentInfo[] = message.attachments_json ? (() => { try { return JSON.parse(message.attachments_json) } catch { return [] } })() : []

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: isHuman ? 'row-reverse' : 'row' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: isHuman ? 'var(--bg-3)' : (agent ? agentColor(agent) : 'var(--bg-3)'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {isHuman ? <User size={14} color="var(--text-2)" /> : <Bot size={14} color="white" />}
      </div>
      <div style={{ maxWidth: '75%', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexDirection: isHuman ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{isHuman ? '你' : agent?.name || 'Agent'}</span>
          {message.timestamp && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{formatTime(message.timestamp)}</span>}
          {message.streaming && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--blue)' }}><Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> 生成中</span>}
        </div>
        <div style={{ padding: '12px 14px', borderRadius: isHuman ? '12px 2px 12px 12px' : '2px 12px 12px 12px', background: isHuman ? 'var(--blue-light)' : 'var(--bg-0)', border: `1px solid ${isHuman ? 'rgba(37,99,235,0.15)' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', maxWidth: '100%', overflow: 'hidden' }}>
          {message.thinking && (
            <div style={{ marginBottom: 8, borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <button type="button" onClick={toggleThinkingOpen} style={{ width: '100%', padding: '6px 10px', border: 'none', background: 'var(--bg-2)', color: 'var(--text-3)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left' }}>
                {thinkingOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 思考过程
                {isStreaming && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
              </button>
              {thinkingOpen && <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic', lineHeight: 1.6, maxHeight: 200, overflow: 'auto', overflowWrap: 'anywhere' }}>{message.thinking}</div>}
            </div>
          )}
          {attachments.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{attachments.map((img, i) => <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt={img.name || '附件'} style={{ maxWidth: 180, maxHeight: 140, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'cover' }} />)}</div>}
          {toolCalls.length > 0 && <div style={{ marginBottom: 8 }}>{toolCalls.map(tc => <ToolCallPanel key={tc.id} tc={tc} isStreaming={isStreaming} />)}</div>}
          {message.content
            ? <MarkdownRenderer content={message.content || ''} />
            : (message.streaming ? <div style={{ fontSize: 13, color: 'var(--text-3)' }}>正在思考...</div> : null)}
          {footer && <div style={{ marginTop: 10 }}>{footer}</div>}
        </div>
        {/* 单次统计 */}
        {turnStats && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, marginTop: 6, fontSize: 10, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden' }}>
            {turnStats.elapsedSeconds != null && <span style={{ ...statChipStyle, fontWeight: 600, color: 'var(--text-2)' }}>⏱ {turnStats.elapsedSeconds}s</span>}
            <span style={statChipStyle}><span style={{ color: 'var(--text-3)' }}>输入</span> <b style={{ color: 'var(--text-2)' }}>{fmtTokens(turnStats.inputTokens)}</b></span>
            <span style={statChipStyle}><span style={{ color: 'var(--text-3)' }}>输出</span> <b style={{ color: 'var(--text-2)' }}>{fmtTokens(turnStats.outputTokens)}</b></span>
            {turnStats.cachedReadTokens != null && turnStats.cachedReadTokens > 0 && <span style={statChipStyle}><span style={{ color: 'var(--text-3)' }}>缓存</span> <b style={{ color: 'var(--text-2)' }}>{fmtTokens(turnStats.cachedReadTokens)}</b></span>}
            {turnStats.costAmount != null && <span style={{ ...statChipStyle, borderRight: 'none' }}>${turnStats.costAmount.toFixed(4)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Dropdown Portal ─── */
function DropdownPortal({ children, onClose, style }: { children: React.ReactNode; onClose: () => void; style: React.CSSProperties }) {
  return (<>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
    <div style={{ position: 'fixed', minWidth: 220, maxHeight: 360, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 2001, padding: 6, boxSizing: 'border-box', transform: 'translateY(-100%)', ...style }}>
      {children}
    </div>
  </>)
}

/* ─── New Task Modal ─── */
function NewTaskModal({ agents, onCreate, onClose }: { agents: AgentData[]; onCreate: (title: string, desc?: string, agentId?: string) => Promise<TaskData>; onClose: () => void }) {
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [agentId, setAgentId] = useState(''); const [creating, setCreating] = useState(false)
  const handleCreate = async () => { if (!title.trim()) return; setCreating(true); try { await onCreate(title, desc || undefined, agentId || undefined); onClose() } catch (e) { console.error('创建任务失败:', e) } finally { setCreating(false) } }
  return (<>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
    <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 440, background: 'var(--bg-0)', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新建任务</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>任务标题</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如: 实现用户登录功能" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' }} /></div>
        <div><label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>描述</label><textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="详细描述需求..." rows={3} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} /></div>
        <div><label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>指派 Agent</label><select value={agentId} onChange={e => setAgentId(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none' }}><option value="">不指派（放入待办）</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.runtime})</option>)}</select></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={handleCreate} disabled={!title.trim() || creating} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: title.trim() ? 1 : 0.5 }}>{creating ? '创建中...' : '创建任务'}</button>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>取消</button>
        </div>
      </div>
    </div>
  </>)
}

