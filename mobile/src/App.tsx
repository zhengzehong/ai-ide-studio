import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useConnectionStore, type ConnectionStatus } from './stores/connection.store'
import { useAppStore } from './stores/app.store'
import { useSessionStore } from './stores/session.store'
import { useChatStore } from './stores/chat.store'
import { useMobileProjectSessionStatsStore } from './stores/project-session-stats.store'
import { wsClient } from '@desktop/services/ws-client'
import MobileShell from './components/MobileShell'
import AndroidBackHandler from './components/AndroidBackHandler'
import ConnectPage from './pages/ConnectPage'
import SessionListPage from './pages/SessionListPage'
import ChatPage from './pages/ChatPage'
import FileViewerPage from './pages/FileViewerPage'
import TaskListPage from './pages/TaskListPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TaskReportPage from './pages/TaskReportPage'
import SettingsPage from './pages/SettingsPage'
import TemplateListPage from './pages/TemplateListPage'
import PreviewPage from './pages/PreviewPage'
import { PinnedSessionsPage } from './pages/PinnedSessionsPage'
import SecretaryPage from './pages/SecretaryPage'
import { usePinnedSessionStore } from './stores/pinned-session.store'
import { useVoiceStore } from './stores/voice.store'

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
    useMobileProjectSessionStatsStore.getState().fetchStats(),
    usePinnedSessionStore.getState().load({ silent: true }),
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
    const off2 = useMobileProjectSessionStatsStore.getState().setupListeners()
    const offPinned = usePinnedSessionStore.getState().setupListeners()
    const offVoice = useVoiceStore.getState().setupListeners()
    const off3 = wsClient.on('resync_required', (message) => {
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
      off2()
      offPinned()
      offVoice()
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
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/files" element={<FileViewerPage />} />
        <Route path="/task/:taskId" element={<TaskDetailPage />} />
        <Route path="/task/:taskId/report/:eventId" element={<TaskReportPage />} />
        <Route path="/preview/:previewId" element={<PreviewPage />} />
        <Route path="/templates" element={<TemplateListPage />} />
        <Route element={<MobileShell />}>
          <Route path="/secretary" element={<SecretaryPage />} />
          <Route path="/secretary/:secretaryId/:threadId" element={<SecretaryPage />} />
          <Route path="/pinned" element={<PinnedSessionsPage />} />
          <Route path="/" element={<SessionListPage />} />
          <Route path="/tasks" element={<TaskListPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppRouter>
  )
}
