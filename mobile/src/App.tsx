import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useConnectionStore, type ConnectionStatus } from './stores/connection.store'
import { useAppStore } from './stores/app.store'
import { useSessionStore } from './stores/session.store'
import { useChatStore } from './stores/chat.store'
import { useMobileProjectSessionStatsStore } from './stores/project-session-stats.store'
import { useInspirationStore } from './stores/inspiration.store'
import { wsClient } from '@desktop/services/ws-client'
import MobileShell from './components/MobileShell'
import AndroidBackHandler from './components/AndroidBackHandler'
import ConnectPage from './pages/ConnectPage'
import SessionListPage from './pages/SessionListPage'
import { ConversationRoute } from './pages/ConversationRoute'
import { useConversationCatalog } from './stores/conversation-catalog.store'
import FileViewerPage from './pages/FileViewerPage'
import TaskListPage from './pages/TaskListPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TaskReportPage from './pages/TaskReportPage'
import SettingsPage from './pages/SettingsPage'
import TemplateListPage from './pages/TemplateListPage'
import PreviewPage from './pages/PreviewPage'
import SecretaryPage from './pages/SecretaryPage'
import InspirationPage from './pages/InspirationPage'
import InspirationRecordPage from './pages/InspirationRecordPage'
import InspirationDetailPage from './pages/InspirationDetailPage'
import { usePinnedSessionStore } from './stores/pinned-session.store'
import { useVoiceStore } from './stores/voice.store'
import { ActivityPage } from './pages/ActivityPage'
import { useMobileActivityStore } from './stores/activity.store'
import { useReadingStore } from '@desktop/stores/reading.store'
import ReadingListPage from './pages/ReadingListPage'
import ReadingDetailPage from './pages/ReadingDetailPage'

const isAndroidBuild = import.meta.env.VITE_MOBILE_BUILD_TARGET === 'android'

function AppRouter({ children }: { children: ReactNode }) {
  if (isAndroidBuild) {
    return <HashRouter>{children}</HashRouter>
  }

  return <BrowserRouter basename="/app">{children}</BrowserRouter>
}

export async function bootstrapMobileData(): Promise<void> {
  const appStore = useAppStore.getState()
  await Promise.all([
    appStore.fetchProjects(),
    appStore.fetchAgents(),
    useConversationCatalog.getState().load(),
    useMobileProjectSessionStatsStore.getState().fetchStats(),
    usePinnedSessionStore.getState().load({ silent: true }),
    useMobileActivityStore.getState().load({ silent: true }),
    useReadingStore.getState().refreshUnreadCount(),
  ])
  await useSessionStore.getState().fetchSessions(useAppStore.getState().currentProjectId)
}

export function shouldShowConnectPage(input: { serverUrl: string; connected: boolean; status: ConnectionStatus }): boolean {
  return !input.serverUrl.trim()
}

export default function App() {
  const { serverUrl, connected, status, init } = useConnectionStore()

  useEffect(() => {
    const off1 = useSessionStore.getState().setupListeners()
    const offCatalog = useConversationCatalog.getState().setupListeners()
    const off2 = useMobileProjectSessionStatsStore.getState().setupListeners()
    const offPinned = usePinnedSessionStore.getState().setupListeners()
    const offActivity = useMobileActivityStore.getState().setupListeners()
    const offVoice = useVoiceStore.getState().setupListeners()
    const offInspiration = useInspirationStore.getState().setupListeners()
    const off3 = wsClient.on('resync_required', (message) => {
      if (useConversationCatalog.getState().activeConversationId) return
      const chatStore = useChatStore.getState()
      const resyncSessionId = typeof message.sessionId === 'string' ? message.sessionId : undefined
      const sessionId = resyncSessionId ?? chatStore.sessionId ?? undefined
      const recovery = sessionId && sessionId === chatStore.sessionId
        ? chatStore.refreshCurrentSession(sessionId)
        : Promise.resolve()
      void recovery.finally(() => wsClient.acknowledgeResync(resyncSessionId))
    })
    wsClient.setEventListenersReady(true)
    init()
    void useVoiceStore.getState().hydrate()
    return () => {
      wsClient.setEventListenersReady(false)
      off1()
      offCatalog()
      off2()
      offPinned()
      offActivity()
      offVoice()
      offInspiration()
      off3()
    }
  }, [init])

  useEffect(() => {
    if (connected) void bootstrapMobileData()
  }, [connected])

  if (shouldShowConnectPage({ serverUrl, connected, status })) {
    return (
      <AppRouter>
        <AndroidBackHandler />
        <Routes>
          <Route path="*" element={<ConnectPage />} />
        </Routes>
      </AppRouter>
    )
  }

  return (
    <AppRouter>
      <AndroidBackHandler />
      <Routes>
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/chat/:sessionId" element={<ConversationRoute />} />
        <Route path="/files" element={<FileViewerPage />} />
        <Route path="/task/:taskId" element={<TaskDetailPage />} />
        <Route path="/task/:taskId/report/:eventId" element={<TaskReportPage />} />
        <Route path="/preview/:previewId" element={<PreviewPage />} />
        <Route path="/reading/:readingId" element={<ReadingDetailPage />} />
        <Route path="/templates" element={<TemplateListPage />} />
        <Route path="/inspiration/new" element={<InspirationRecordPage />} />
        <Route path="/inspiration/:noteId" element={<InspirationDetailPage />} />
        <Route element={<MobileShell />}>
          <Route path="/secretary" element={<SecretaryPage />} />
          <Route path="/secretary/:secretaryId/:threadId" element={<SecretaryPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/reading" element={<ReadingListPage />} />
          <Route path="/pinned" element={<Navigate to="/?view=pinned" replace />} />
          <Route path="/" element={<SessionListPage />} />
          <Route path="/tasks" element={<TaskListPage />} />
          <Route path="/inspiration" element={<InspirationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppRouter>
  )
}
