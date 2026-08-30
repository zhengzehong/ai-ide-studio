import { useState } from 'react'
import { ConversationPane } from '../components/chat/ConversationPane'
import type { ConversationPaneProps } from '../components/chat/conversation-types'
import { useSessionDockStore } from '../stores/session-dock.store'
import { useWorkbenchSessionStore } from '../stores/workbench-session.store'
import type { WorkbenchSessionTarget } from './UpdatesSidebar'

interface UpdatesConversationProps {
  target: WorkbenchSessionTarget | null
  onSelectTarget: (target: WorkbenchSessionTarget) => Promise<void>
}

export function UpdatesConversation({ target }: UpdatesConversationProps) {
  const selectedSessionId = useWorkbenchSessionStore((state) => state.selectedSessionId)
  const adapter = useWorkbenchSessionStore((state) => ({
    sessionId: state.selectedSessionId,
    projectId: target?.projectId ?? null,
    agentName: target?.agentName ?? null,
    agentRuntime: null,
    sessionTitle: target?.title ?? null,
    messages: state.messages,
    streamingMessage: state.streamingMessage,
    loading: state.loading,
    error: state.error,
    running: state.running,
    sending: state.sending,
    hasMoreMessages: state.hasMoreMessages,
    loadingOlderMessages: state.loadingOlderMessages,
    pendingPermissions: state.pendingPermissions,
    pendingElicitations: state.pendingElicitations,
    interactionError: state.interactionError,
    capabilities: state.capabilities,
    usage: state.usage,
    processByMessageId: state.processByMessageId,
    fileChangeDetailsByMessageId: state.fileChangeDetailsByMessageId,
    fileChangeLoadingByKey: state.fileChangeLoadingByKey,
    fileChangeErrorByKey: state.fileChangeErrorByKey,
    toolCallDetailsByKey: state.toolCallDetailsByKey,
    processItemLoadingByKey: state.processItemLoadingByKey,
    processItemErrorByKey: state.processItemErrorByKey,
    sendPrompt: state.sendPrompt,
    cancel: state.cancel,
    loadOlderMessages: state.loadOlderMessages,
    reload: state.selectedSessionId ? () => state.select(state.selectedSessionId) : undefined,
    loadMessageProcess: state.loadMessageProcess,
    loadFileChanges: state.loadFileChanges,
    loadProcessItemDetail: state.loadProcessItemDetail,
    setModel: state.setModel,
    setMode: state.setMode,
    setConfig: state.setConfig,
    respondPermission: state.respondPermission,
    respondElicitation: state.respondElicitation,
  }))
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
    pinned,
    onTogglePin: pinPending ? undefined : () => { void togglePin() },
  }
  return <ConversationPane {...paneProps} />
}
