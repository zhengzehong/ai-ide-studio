import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConversationPane } from '../components/chat/ConversationPane'
import type { ConversationPaneProps } from '../components/chat/conversation-types'
import { conversationDrafts } from '../components/chat/conversation-drafts'
import { useConnectionStore } from '../stores/connection.store'
import { useSessionDockStore } from '../stores/session-dock.store'
import { useWorkbenchSessionStore } from '../stores/workbench-session.store'
import type { WorkbenchSessionTarget } from './UpdatesSidebar'
import type { FilesPresentationInfo, PreviewPresentationInfo } from '../stores/session-events'

interface UpdatesConversationProps {
  target: WorkbenchSessionTarget | null
  onSelectTarget: (target: WorkbenchSessionTarget) => Promise<void>
  onOpenPreview?: (preview: PreviewPresentationInfo) => void
  onOpenFiles?: (presentation: FilesPresentationInfo) => void
}

export function UpdatesConversation({ target, onOpenPreview, onOpenFiles }: UpdatesConversationProps) {
  const workbenchState = useWorkbenchSessionStore()
  const connected = useConnectionStore((state) => state.connected)
  useEffect(() => () => conversationDrafts.dispose(), [])
  const selectedSessionId = workbenchState.selectedSessionId
  const selectSession = workbenchState.select
  const reloadSession = useCallback(async (): Promise<void> => {
    if (selectedSessionId) await selectSession(selectedSessionId)
  }, [selectedSessionId, selectSession])
  const adapter = useMemo<ConversationPaneProps['adapter']>(() => ({
    sessionId: workbenchState.selectedSessionId,
    projectId: target?.projectId ?? null,
    agentName: target?.agentName ?? null,
    agentRuntime: null,
    sessionTitle: target?.title ?? null,
    messages: workbenchState.messages,
    events: workbenchState.events,
    streamingMessage: workbenchState.streamingMessage,
    loading: workbenchState.loading,
    error: workbenchState.error,
    running: workbenchState.running,
    sending: workbenchState.sending,
    stopping: workbenchState.stopping,
    stopError: workbenchState.stopError,
    connected,
    hasMoreMessages: workbenchState.hasMoreMessages,
    loadingOlderMessages: workbenchState.loadingOlderMessages,
    pendingPermissions: workbenchState.pendingPermissions,
    pendingElicitations: workbenchState.pendingElicitations,
    interactionError: workbenchState.interactionError,
    capabilities: workbenchState.capabilities,
    usage: workbenchState.usage,
    processByMessageId: workbenchState.processByMessageId,
    fileChangeDetailsByMessageId: workbenchState.fileChangeDetailsByMessageId,
    fileChangeLoadingByKey: workbenchState.fileChangeLoadingByKey,
    fileChangeErrorByKey: workbenchState.fileChangeErrorByKey,
    processItemLoadingByKey: workbenchState.processItemLoadingByKey,
    processItemErrorByKey: workbenchState.processItemErrorByKey,
    sendPrompt: workbenchState.sendPrompt,
    cancel: workbenchState.cancel,
    forceFinish: workbenchState.forceFinish,
    loadOlderMessages: workbenchState.loadOlderMessages,
    reload: selectedSessionId ? reloadSession : undefined,
    loadMessageProcess: workbenchState.loadMessageProcess,
    loadFileChanges: workbenchState.loadFileChanges,
    loadProcessItemDetail: workbenchState.loadProcessItemDetail,
    setModel: workbenchState.setModel,
    setMode: workbenchState.setMode,
    setConfig: workbenchState.setConfig,
    respondPermission: workbenchState.respondPermission,
    respondElicitation: workbenchState.respondElicitation,
  }), [connected, reloadSession, selectedSessionId, target, workbenchState])
  const dockItems = useSessionDockStore((state) => state.items)
  const addToDock = useSessionDockStore((state) => state.add)
  const removeFromDock = useSessionDockStore((state) => state.remove)
  const [pinPending, setPinPending] = useState(false)
  const pinned = !!selectedSessionId && dockItems.some((item) => item.sessionId === selectedSessionId)

  const togglePin = async (): Promise<void> => {
    if (!selectedSessionId || pinPending) return
    setPinPending(true)
    try {
      if (pinned) await removeFromDock(selectedSessionId)
      else await addToDock(selectedSessionId)
    } finally { setPinPending(false) }
  }

  const paneProps: ConversationPaneProps = {
    adapter,
    onOpenPreview,
    onOpenFiles,
    pinned,
    onTogglePin: pinPending ? undefined : () => { void togglePin() },
  }
  return <ConversationPane {...paneProps} />
}
