import { Suspense, useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import {
  AccessTokenPage,
  AgentMemory,
  AgentSquare,
  Autonomy,
  Dashboard,
  EventCenter,
  GuestChatPage,
  KnowledgeBase,
  Inspiration,
  Projects,
  ReadingPage,
  PinnedSessions,
  Schedule,
  Secretary,
  Settings,
  ShareManagePage,
  SkillCenter,
  TaskBoard,
  TaskModesSettings,
  TemplatesPage,
  ToolManager,
  UpdatesPage,
  WidgetPage,
  Workspace,
} from './routes/lazy-pages'
import { useConnectionStore } from './stores/connection.store'
import { ProjectScopeLayout } from './components/project/ProjectScopeLayout'
import { LegacyProjectRedirect } from './components/project/LegacyProjectRedirect'
import { shouldShowAccessTokenPage } from './app-shell-state'
import { getElectronDesktopBridge, subscribeDesktopNavigation } from './services/electron-desktop'

export default function App() {
  const init = useConnectionStore((s) => s.init)
  const connected = useConnectionStore((s) => s.connected)
  const authRequired = useConnectionStore((s) => s.authRequired)
  const connectedOnce = useRef(false)

  useEffect(() => {
    let disposed = false
    let stopListeners: (() => void) | undefined
    void import('./app-runtime-bootstrap').then((module) => {
      if (disposed) return
      stopListeners = module.startAppRuntimeListeners()
      if (disposed) {
        stopListeners()
        return
      }
      init()
    })
    return () => {
      disposed = true
      stopListeners?.()
    }
  }, [init])

  useEffect(() => {
    if (!connected) return
    if (connectedOnce.current) return
    connectedOnce.current = true
    void import('./app-runtime-bootstrap').then((module) => {
      module.refreshConnectedAppRuntime(false)
    })
  }, [connected])

  return (
    <Suspense fallback={<RouteLoading />}>
      {shouldShowAccessTokenPage({ connected, authRequired }) ? (
        <AccessTokenPage />
      ) : (
        <BrowserRouter>
          <DesktopNavigationListener />
          <RouteCommitMarker />
          <Routes>
            <Route path="/share/:token" element={<GuestChatPage />} />
            <Route path="/widget" element={<WidgetPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pinned" element={<PinnedSessions />} />
              <Route path="/reading" element={<ReadingPage />} />
              <Route path="/updates" element={<UpdatesPage />} />
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
                <Route path="autonomy" element={<Autonomy />} />
                <Route path="secretary" element={<Secretary />} />
                <Route path="inspiration" element={<Inspiration />} />
              </Route>
              <Route path="/workspace" element={<LegacyProjectRedirect subpath="/workspace" />} />
              <Route path="/tasks" element={<LegacyProjectRedirect subpath="/tasks" />} />
              <Route path="/tasks/modes" element={<LegacyProjectRedirect subpath="/tasks/modes" />} />
              <Route path="/schedule" element={<LegacyProjectRedirect subpath="/schedule" />} />
              <Route path="/events" element={<LegacyProjectRedirect subpath="/events" />} />
              <Route path="/knowledge" element={<LegacyProjectRedirect subpath="/knowledge" />} />
              <Route path="/agent-memory" element={<LegacyProjectRedirect subpath="/agent-memory" />} />
              <Route path="/autonomy" element={<LegacyProjectRedirect subpath="/autonomy" />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/shares" element={<ShareManagePage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      )}
    </Suspense>
  )
}

function DesktopNavigationListener() {
  const navigate = useNavigate()

  useEffect(() => subscribeDesktopNavigation(getElectronDesktopBridge(), navigate), [navigate])
  return null
}

function RouteLoading() {
  return <div role="status" aria-label="页面加载中" style={{ minHeight: '100vh', background: 'var(--bg-1)' }} />
}

function RouteCommitMarker() {
  const location = useLocation()

  useEffect(() => {
    performance.mark('ai-ide-route-commit', { detail: { path: location.pathname } })
    if (performance.getEntriesByName('ai-ide-interactive').length === 0) {
      performance.mark('ai-ide-interactive')
    }
    dispatchEvent(
      new CustomEvent('ai-ide-route-commit', {
        detail: { path: location.pathname },
      }),
    )
  }, [location.pathname])

  return null
}
