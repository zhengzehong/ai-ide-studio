import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useConnectionStore } from './stores/connection.store'
import { useAppStore } from './stores/app.store'
import { useSessionStore } from './stores/session.store'
import MobileShell from './components/MobileShell'
import ConnectPage from './pages/ConnectPage'
import SessionListPage from './pages/SessionListPage'
import ChatPage from './pages/ChatPage'
import TaskListPage from './pages/TaskListPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const { connected, serverUrl, init } = useConnectionStore()
  const listenersReady = useRef(false)

  useEffect(() => { init() }, [init])

  useEffect(() => {
    if (!connected) return
    useAppStore.getState().fetchProjects()
    useAppStore.getState().fetchAgents()
    useSessionStore.getState().fetchSessions()

    if (!listenersReady.current) {
      listenersReady.current = true
      const off1 = useSessionStore.getState().setupListeners()
      return () => { off1(); listenersReady.current = false }
    }
  }, [connected])

  if (!serverUrl) {
    return (
      <BrowserRouter basename="/app">
        <Routes>
          <Route path="*" element={<ConnectPage />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route element={<MobileShell />}>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/tasks" element={<TaskListPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
