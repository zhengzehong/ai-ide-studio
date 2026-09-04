import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { GripVertical, Plus, Zap, ChevronDown, Loader2, RefreshCw, Tag, Archive } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { SessionBulkActionResultData, SessionData } from '../../stores/session.store'
import type { SessionIndicatorStateMap } from '../../utils/session-indicators'
import { agentAvatar, agentColor, formatTime, sessionTitle } from './helpers'
import { prepareNestedOrderDragEvent } from './ordering'
import { sessionIndicator } from '../../utils/session-indicators'
import { ICON_MAP } from '../../components/agent-square/constants'
import { SessionBulkActions } from './SessionBulkActions'
import { canSelectSessionForBatchDelete, toggleBatchSessionSelection, batchDeletableSessionIds } from './session-bulk-selection'
import { useWorkspaceProjectState } from './use-workspace-project-state'
import {
  sessionTagColor,
  splitSessionsByArchive,
  collectScopeTags,
  filterSessionsByTags,
  effectiveSessionTagFilter,
} from './session-tags'
import { SessionTagEditor } from './SessionTagEditor'
import { subscribeHotkeyActions } from '../../lib/hotkey-actions'

const orderGripStyle: React.CSSProperties = {
  width: 16,
  height: 20,
  borderRadius: 4,
  color: 'var(--text-3)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'grab',
  flexShrink: 0,
  opacity: 0.72,
}

const tagChipStyle = (tag: string): React.CSSProperties => {
  const [background, foreground] = sessionTagColor(tag)
  return {
    fontSize: 9.5,
    lineHeight: 1,
    padding: '2px 5px',
    borderRadius: 999,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background,
    color: foreground,
  }
}

export interface SessionBarDraggedItem {
  type: 'agent' | 'session'
  id: string
  agentId?: string
}

export interface SessionContextMenuContext {
  inArchive: boolean
}

export interface SessionTagEditorState {
  sessionId: string
  x: number
  y: number
}

export interface SessionBarProps {
  agent: AgentData | null
  projectId: string | null
  sessions: SessionData[]
  currentSessionId: string | null
  runningSessionIds: SessionIndicatorStateMap
  unreadSessionIds: SessionIndicatorStateMap
  orderingMode: boolean
  draggedOrderItem: SessionBarDraggedItem | null
  loadState: 'loading' | 'error' | 'empty' | 'ready'
  loadError: string | null
  tagEditor: SessionTagEditorState | null
  onSelectSession: (agentId: string, sessionId: string) => void
  onNewSession: (agentId: string) => void
  onNewFromTemplate: (agentId: string) => void
  onBulkMarkRead: (agentId: string, projectId: string, sessionIds: string[]) => Promise<SessionBulkActionResultData>
  onBulkDelete: (agentId: string, projectId: string, sessionIds: string[]) => Promise<SessionBulkActionResultData>
  onSetSessionTags: (sessionId: string, tags: string[]) => Promise<void>
  onRestoreSession: (sessionId: string) => Promise<void>
  onCloseTagEditor: () => void
  onContextMenu: (e: MouseEvent, sessionId: string, agentId: string, context: SessionContextMenuContext) => void
  onReorder: (agentId: string, sessionIds: string[]) => void
  onSetDraggedOrderItem: (item: SessionBarDraggedItem | null) => void
  onDropSession: (agentId: string, targetSessionId: string) => void
  onRetry: () => void
}

export function SessionBar(props: SessionBarProps) {
  const {
    agent,
    projectId,
    sessions,
    currentSessionId,
    runningSessionIds,
    unreadSessionIds,
    orderingMode,
    draggedOrderItem,
    loadState,
    loadError,
    tagEditor,
    onSelectSession,
    onNewSession,
    onNewFromTemplate,
    onContextMenu,
    onSetDraggedOrderItem,
    onDropSession,
    onRetry,
  } = props

  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkNotice, setBulkNotice] = useState<string | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  // 归档视图与标签筛选走 per-project 视图状态（localStorage 持久化），
  // 跳转其他页面、切换侧栏 tab 后返回不丢失。
  const { showArchived, sessionTagFilter, setShowArchived, setSessionTagFilter } = useWorkspaceProjectState(projectId)

  const { active: activeSessions, archived: archivedSessions } = splitSessionsByArchive(sessions)
  const visibleSessions = showArchived ? archivedSessions : activeSessions
  const scopeTags = collectScopeTags(sessions)
  const effectiveFilterTags = effectiveSessionTagFilter(sessionTagFilter, scopeTags)
  const filteredSessions = filterSessionsByTags(visibleSessions, effectiveFilterTags)

  // 还原最后一个归档会话后归档区变空：自动回到正常视图（原型行为）。
  const prevArchivedCountRef = useRef(0)
  useEffect(() => {
    const previousCount = prevArchivedCountRef.current
    prevArchivedCountRef.current = archivedSessions.length
    if (showArchived && archivedSessions.length === 0 && previousCount > 0) {
      setShowArchived(false)
    }
  }, [archivedSessions.length, showArchived, setShowArchived])

  useEffect(() => {
    if (!agent) return undefined
    const stop = subscribeHotkeyActions((actionId) => {
      const currentIndex = filteredSessions.findIndex((session) => session.id === currentSessionId)
      if (actionId === 'ws.new-session') {
        onNewSession(agent.id)
        return
      }
      if (actionId === 'ws.focus-session-list') {
        const target = document.querySelector<HTMLButtonElement>(`[data-hotkey-session-list] [data-session-id="${currentSessionId ?? filteredSessions[0]?.id ?? ''}"]`)
        target?.focus()
        return
      }
      if (actionId === 'session.open') {
        const targetId = currentSessionId ?? filteredSessions[0]?.id
        if (targetId) onSelectSession(agent.id, targetId)
        return
      }
      if (actionId === 'session.next' || actionId === 'session.prev') {
        if (filteredSessions.length === 0) return
        const offset = actionId === 'session.next' ? 1 : -1
        const nextIndex = currentIndex < 0
          ? (offset > 0 ? 0 : filteredSessions.length - 1)
          : (currentIndex + offset + filteredSessions.length) % filteredSessions.length
        onSelectSession(agent.id, filteredSessions[nextIndex].id)
        return
      }
    })
    return stop
  }, [agent, currentSessionId, filteredSessions, onNewSession, onSelectSession])

  const sessionBelongsToBatchView = (session: SessionData): {
    id: string
    isPrimary: boolean
    isRunning: boolean
    isCurrent: boolean
  } => ({
    id: session.id,
    isPrimary: !!session.is_primary,
    isRunning: !!runningSessionIds[session.id] || session.activity_state === 'running',
    isCurrent: currentSessionId === session.id,
  })

  const selectableSessionIds = batchDeletableSessionIds(filteredSessions.map(sessionBelongsToBatchView))
  const selectedDeletableIds = selectedSessionIds.filter((id) => selectableSessionIds.includes(id))
  const allSelected = selectableSessionIds.length > 0 && selectedDeletableIds.length === selectableSessionIds.length

  const enterBatchMode = (): void => {
    setBulkMenuOpen(false)
    setBulkNotice(null)
    setBulkError(null)
    setSelectedSessionIds([])
    setBatchMode(true)
  }

  const cancelBatchMode = (): void => {
    if (bulkBusy) return
    setBatchMode(false)
    setSelectedSessionIds([])
    setConfirmDelete(false)
    setBulkError(null)
  }

  const toggleSelectAll = (): void => {
    if (bulkBusy) return
    setSelectedSessionIds(allSelected ? [] : selectableSessionIds)
  }

  const handleToggleSession = (session: SessionData): void => {
    setSelectedSessionIds((selected) => toggleBatchSessionSelection(selected, sessionBelongsToBatchView(session)))
  }

  const handleBulkMarkRead = async (): Promise<void> => {
    if (!agent || !projectId || bulkBusy || filteredSessions.length === 0) return
    setBulkMenuOpen(false)
    setBulkBusy(true)
    setBulkNotice(null)
    setBulkError(null)
    try {
      const result = await props.onBulkMarkRead(agent.id, projectId, filteredSessions.map((session) => session.id))
      setBulkNotice(`已标记 ${result.succeeded.length} 个会话为已读`)
      if (result.skipped.length > 0) setBulkError(`有 ${result.skipped.length} 个会话未处理`)
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : '批量标记已读失败')
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkDelete = async (): Promise<void> => {
    if (!agent || !projectId || bulkBusy || selectedDeletableIds.length === 0) return
    setBulkBusy(true)
    setBulkNotice(null)
    setBulkError(null)
    try {
      const result = await props.onBulkDelete(agent.id, projectId, selectedDeletableIds)
      setBulkNotice(`已删除 ${result.succeeded.length} 个会话`)
      if (result.skipped.length > 0) setBulkError(`有 ${result.skipped.length} 个会话未删除`)
      setSelectedSessionIds([])
      setConfirmDelete(false)
      setBatchMode(false)
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : '批量删除失败')
    } finally {
      setBulkBusy(false)
    }
  }

  const toggleFilterTag = (tag: string): void => {
    // 基于生效集合 toggle：失效的持久化 tag 不会在切换其他 tag 时被“续命”。
    setSessionTagFilter(effectiveFilterTags.includes(tag)
      ? effectiveFilterTags.filter((item) => item !== tag)
      : [...effectiveFilterTags, tag])
  }

  const tagEditorSession = tagEditor ? sessions.find((session) => session.id === tagEditor.sessionId) : undefined

  return (
    <aside
      data-hotkey-session-list
      data-hotkey-scope="list"
      style={{
        width: 200,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 1,
          height: '100%',
          background:
            'linear-gradient(to bottom, transparent, var(--border) 10%, var(--border) 90%, transparent)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      <header
        style={{
          padding: '12px 14px 12px 17px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          minWidth: 0,
          position: 'relative',
          background: 'var(--bg-1)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: 'var(--blue)',
          }}
        />
        {agent ? (
          <>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: agentColor(agent),
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 600,
                color: 'white',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              <SessionBarAvatar agent={agent} size={18} />
            </span>
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-1)',
                minWidth: 0,
              }}
              title={agent.name}
            >
              {agent.name}
            </span>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setNewMenuOpen((v) => !v)}
                title="新建会话"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  height: 22,
                  padding: '0 4px',
                  border: 'none',
                  background: newMenuOpen ? 'var(--blue-light)' : 'transparent',
                  color: newMenuOpen ? 'var(--blue)' : 'var(--text-3)',
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
              >
                <Plus size={14} />
                <ChevronDown size={10} />
              </button>
              {newMenuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 998 }}
                    onClick={() => setNewMenuOpen(false)}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      minWidth: 140,
                      background: 'var(--bg-0)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
                      padding: 4,
                      zIndex: 999,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setNewMenuOpen(false)
                        onNewSession(agent.id)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 10px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-1)',
                        fontSize: 13,
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 4,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-2)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >
                      空白会话
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewMenuOpen(false)
                        onNewFromTemplate(agent.id)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 10px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-1)',
                        fontSize: 13,
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderRadius: 4,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-2)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                    >
                      从模板新建...
                    </button>
                  </div>
                </>
              )}
            </div>
            <SessionBulkActions
              menuOpen={bulkMenuOpen}
              batchMode={batchMode}
              selectedCount={selectedDeletableIds.length}
              deletableCount={selectableSessionIds.length}
              allSelected={allSelected}
              busy={bulkBusy}
              disabled={orderingMode || !projectId || filteredSessions.length === 0}
              confirmDelete={confirmDelete}
              notice={bulkNotice}
              error={bulkError}
              onToggleMenu={() => setBulkMenuOpen((value) => !value)}
              onMarkRead={() => { void handleBulkMarkRead() }}
              onEnterDeleteMode={enterBatchMode}
              onToggleSelectAll={toggleSelectAll}
              onRequestDelete={() => setConfirmDelete(true)}
              onCancelMode={cancelBatchMode}
              onConfirmDelete={() => { void handleBulkDelete() }}
              onCancelConfirm={() => setConfirmDelete(false)}
            />
          </>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>选择智能体</span>
        )}
      </header>

      {agent ? (
        <>
          {showArchived && (
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--text-3)',
                padding: '6px 12px 0',
                flexShrink: 0,
              }}
            >
              已归档会话 · 右键可还原或删除
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
            {loadState === 'loading' ? (
              <div
                style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
                <div>正在加载会话...</div>
              </div>
            ) : loadState === 'error' ? (
              <div
                role="alert"
                style={{
                  padding: '28px 14px',
                  textAlign: 'center',
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                <div style={{ color: 'var(--red)', marginBottom: 8 }}>{loadError || '会话加载失败'}</div>
                <button
                  type="button"
                  onClick={onRetry}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    background: 'var(--bg-0)',
                    color: 'var(--text-2)',
                    padding: '5px 9px',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={12} /> 重试
                </button>
              </div>
            ) : sessions.length === 0 ? (
              <div
                style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                无会话,点 + 新建
              </div>
            ) : filteredSessions.length === 0 ? (
              <div
                style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                {showArchived ? '还没有归档会话' : '无匹配会话'}
              </div>
            ) : (
              filteredSessions.map((s) => {
                const indicator = sessionIndicator(s, runningSessionIds, unreadSessionIds)
                const sessionTags = s.tags ?? []
                return (
                  <div
                    key={s.id}
                    onDragOver={(e) => {
                      if (!orderingMode) return
                      prepareNestedOrderDragEvent(e)
                    }}
                    onDrop={(e) => {
                      if (!orderingMode) return
                      prepareNestedOrderDragEvent(e)
                      onDropSession(agent.id, s.id)
                    }}
                    onContextMenu={(e) => {
                      if (orderingMode || batchMode) return
                      e.preventDefault()
                      onContextMenu(e, s.id, agent.id, { inArchive: showArchived })
                    }}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 12,
                      paddingRight: 8,
                      background: currentSessionId === s.id ? 'var(--blue-light)' : 'transparent',
                      borderRadius: 4,
                      opacity:
                        draggedOrderItem?.type === 'session' && draggedOrderItem.id === s.id ? 0.55 : 1,
                      transition: 'background 0.15s',
                      boxShadow: currentSessionId === s.id ? 'inset 2px 0 0 var(--blue)' : 'none',
                    }}
                  >
                    {batchMode && (
                      <input
                        type="checkbox"
                        checked={selectedDeletableIds.includes(s.id)}
                        disabled={!canSelectSessionForBatchDelete(sessionBelongsToBatchView(s)) || bulkBusy}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => handleToggleSession(s)}
                        aria-label={`选择会话 ${sessionTitle(s)}`}
                        style={{ margin: '0 2px 0 0', flexShrink: 0 }}
                      />
                    )}
                    <button
                      type="button"
                      data-session-id={s.id}
                      onClick={() => {
                        if (batchMode) {
                          handleToggleSession(s)
                          return
                        }
                        if (!orderingMode) onSelectSession(agent.id, s.id)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 0',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-1)',
                        cursor: orderingMode ? 'default' : 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {orderingMode && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation()
                            onSetDraggedOrderItem({ type: 'session', id: s.id, agentId: agent.id })
                          }}
                          onDragEnd={(e) => {
                            e.stopPropagation()
                            onSetDraggedOrderItem(null)
                          }}
                          style={orderGripStyle}
                          title="拖拽排序"
                        >
                          <GripVertical size={13} />
                        </span>
                      )}
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: indicator.color,
                          flexShrink: 0,
                          animation: indicator.pulse
                            ? 'session-running-pulse 1s ease-in-out infinite'
                            : undefined,
                          boxShadow: indicator.pulse
                            ? '0 0 0 4px rgba(5, 150, 105, 0.12)'
                            : undefined,
                        }}
                        title={indicator.title}
                      />
                      {s.is_primary ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            color: 'var(--blue)',
                            fontSize: 13,
                            flexShrink: 0,
                          }}
                          title="主会话"
                        >
                          <Zap size={12} fill="var(--blue)" />
                        </span>
                      ) : null}
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: s.is_primary ? 600 : 400,
                          }}
                          title={sessionTitle(s)}
                        >
                          {sessionTitle(s)}
                        </span>
                        {sessionTags.length > 0 && (
                          <span style={{ display: 'flex', gap: 3, overflow: 'hidden' }}>
                            {sessionTags.map((tag) => (
                              <span key={tag} style={tagChipStyle(tag)}>
                                {tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-3)',
                          flexShrink: 0,
                          marginLeft: 4,
                        }}
                      >
                        {formatTime(s.last_message_at || s.updated_at || s.started_at)}
                      </span>
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid var(--border)',
              background: 'var(--bg-0)',
              padding: '8px 9px 9px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {scopeTags.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  alignItems: 'center',
                  paddingBottom: 8,
                  borderBottom: '1px dashed var(--border-light)',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'var(--text-3)',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    letterSpacing: '0.05em',
                  }}
                >
                  <Tag size={10} style={{ opacity: 0.65 }} />
                  标签筛选
                  {effectiveFilterTags.length > 0 && (
                    <>
                      <span>· 已选 {effectiveFilterTags.length}</span>
                      <button
                        type="button"
                        onClick={() => setSessionTagFilter([])}
                        style={{
                          marginLeft: 'auto',
                          fontSize: 10.5,
                          fontWeight: 500,
                          color: 'var(--blue)',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: '1px 6px',
                          borderRadius: 4,
                        }}
                      >
                        清除
                      </button>
                    </>
                  )}
                </div>
                {scopeTags.map((tag) => {
                  const selected = effectiveFilterTags.includes(tag)
                  const [background, foreground] = sessionTagColor(tag)
                  return (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => toggleFilterTag(tag)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 10.5,
                        lineHeight: 1,
                        padding: '4px 9px',
                        borderRadius: 999,
                        border: `1px solid ${selected ? foreground : 'var(--border)'}`,
                        background: selected ? background : 'var(--bg-0)',
                        color: selected ? foreground : 'var(--text-2)',
                        fontWeight: selected ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={(e) => {
                        if (selected) return
                        e.currentTarget.style.borderColor = 'var(--bg-4)'
                        e.currentTarget.style.background = 'var(--bg-1)'
                      }}
                      onMouseLeave={(e) => {
                        if (selected) return
                        e.currentTarget.style.borderColor = 'var(--border)'
                        e.currentTarget.style.background = 'var(--bg-0)'
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: selected ? foreground : 'var(--bg-4)',
                          flexShrink: 0,
                        }}
                      />
                      {tag}
                    </button>
                  )
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 9px',
                border: `1px solid ${showArchived ? 'rgba(217,119,6,.45)' : 'var(--border)'}`,
                borderRadius: 8,
                background: showArchived ? 'var(--yellow-light)' : 'var(--bg-0)',
                color: showArchived ? 'var(--yellow)' : 'var(--text-2)',
                fontSize: 12,
                fontWeight: showArchived ? 600 : 400,
                cursor: 'pointer',
                width: '100%',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (showArchived) return
                e.currentTarget.style.borderColor = 'var(--bg-4)'
                e.currentTarget.style.background = 'var(--bg-1)'
              }}
              onMouseLeave={(e) => {
                if (showArchived) return
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.background = 'var(--bg-0)'
              }}
            >
              <Archive size={12} />
              <span>{showArchived ? '返回会话列表' : '已归档'}</span>
            </button>
          </div>
        </>
      ) : null}

      {tagEditorSession && tagEditor && (
        <SessionTagEditor
          sessionTitle={sessionTitle(tagEditorSession)}
          sessionTags={tagEditorSession.tags ?? []}
          scopeTags={scopeTags}
          anchorX={tagEditor.x}
          anchorY={tagEditor.y}
          onChange={(tags) => { void props.onSetSessionTags(tagEditor.sessionId, tags) }}
          onClose={props.onCloseTagEditor}
        />
      )}
    </aside>
  )
}

function SessionBarAvatar({ agent, size }: { agent: AgentData; size: number }) {
  const result = agentAvatar(agent)
  if (result.kind === 'image') {
    return (
      <img
        src={result.src}
        alt={agent.name}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
      />
    )
  }
  if (result.kind === 'icon') {
    const IconComp = ICON_MAP[result.name]
    return IconComp ? <IconComp size={Math.floor(size * 0.6)} color="white" /> : null
  }
  return <>{result.text}</>
}
