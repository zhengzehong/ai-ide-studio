import { useEffect, useRef, type ReactNode } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useConnectionStore, type ConnectionStatus } from './stores/connection.store'
import { useAppStore } from './stores/app.store'
import { useSessionStore } from './stores/session.store'
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

const isAndroidBuild = import.meta.env.VITE_MOBILE_BUILD_TARGET === 'android'

function AppRouter({ children }: { children: ReactNode }) {
  if (isAndroidBuild) {
    return <HashRouter>{children}</HashRouter>
  }

  return <BrowserRouter basename="/app">{children}</BrowserRouter>
}

export async function bootstrapMobileData(): Promise<void> {
  const appStore = useAppStore.getState()
  await Promise.all([appStore.fetchProjects(), appStore.fetchAgents()])
  await useSessionStore.getState().fetchSessions(useAppStore.getState().currentProjectId)
}

export function shouldShowConnectPage(input: { serverUrl: string; connected: boolean; status: ConnectionStatus }): boolean {
  return !input.serverUrl.trim()
}

export default function App() {
  const { serverUrl, connected, status, init } = useConnectionStore()
  const listenersReady = useRef(false)

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!connected) return
    void bootstrapMobileData()

    if (!listenersReady.current) {
      listenersReady.current = true
      const off1 = useSessionStore.getState().setupListeners()
      return () => { off1(); listenersReady.current = false }
    }
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
          <Route path="/" element={<SessionListPage />} />
          <Route path="/tasks" element={<TaskListPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppRouter>
  )
}
