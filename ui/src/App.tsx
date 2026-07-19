import { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import {
  AccessTokenPage,
  AgentMemory,
  AgentSquare,
  Dashboard,
  EventCenter,
  GuestChatPage,
  KnowledgeBase,
  Projects,
  Schedule,
  Settings,
  ShareManagePage,
  SkillCenter,
  TaskBoard,
  TaskModesSettings,
  TemplatesPage,
  ToolManager,
  WidgetPage,
  Workspace,
} from './routes/lazy-pages'
import { useConnectionStore } from './stores/connection.store'
import { ProjectScopeLayout } from './components/project/ProjectScopeLayout'
import { LegacyProjectRedirect } from './components/project/LegacyProjectRedirect'

export default function App() {
  const init = useConnectionStore((s) => s.init)
  const connected = useConnectionStore((s) => s.connected)
  const authRequired = useConnectionStore((s) => s.authRequired)
  const connectedOnce = useRef(false)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!connected) return
    const isReconnect = connectedOnce.current
    connectedOnce.current = true
    let disposed = false
    let stopRuntime: (() => void) | undefined
    void import('./app-runtime-bootstrap').then((module) => {
      if (disposed) return
      stopRuntime = module.startConnectedAppRuntime(isReconnect)
      if (disposed) stopRuntime()
    })
    return () => {
      disposed = true
      stopRuntime?.()
    }
  }, [connected])

  return (
    <Suspense fallback={<RouteLoading />}>
      {authRequired ? <AccessTokenPage /> : <BrowserRouter>
        <Routes>
        <Route path="/share/:token" element={<GuestChatPage />} />
        <Route path="/widget" element={<WidgetPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<AgentSquare />} />
          <Route path="/skills" element={<SkillCenter />} />
          <Route path="/tools" element={<ToolManager />} />
          <Route path="/p/:projectId" element={<ProjectScopeLayout />}>
            <Route index element={<Navigate to="workspace" replace />} />
            <Route path="workspace" element={<Workspace />} />
            <Route path="tasks" element={<TaskBoard />} />
            <Route path="tasks/modes" element={<TaskModesSettings />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="events" element={<EventCenter />} />
            <Route path="knowledge" element={<KnowledgeBase />} />
            <Route path="agent-memory" element={<AgentMemory />} />
          </Route>
          <Route path="/workspace" element={<LegacyProjectRedirect subpath="/workspace" />} />
          <Route path="/tasks" element={<LegacyProjectRedirect subpath="/tasks" />} />
          <Route path="/tasks/modes" element={<LegacyProjectRedirect subpath="/tasks/modes" />} />
          <Route path="/schedule" element={<LegacyProjectRedirect subpath="/schedule" />} />
          <Route path="/events" element={<LegacyProjectRedirect subpath="/events" />} />
          <Route path="/knowledge" element={<LegacyProjectRedirect subpath="/knowledge" />} />
          <Route path="/agent-memory" element={<LegacyProjectRedirect subpath="/agent-memory" />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/shares" element={<ShareManagePage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        </Routes>
      </BrowserRouter>}
    </Suspense>
  )
}

function RouteLoading() {
  return (
    <div
      role="status"
      aria-label="页面加载中"
      style={{ minHeight: '100vh', background: 'var(--bg-1)' }}
    />
  )
}
