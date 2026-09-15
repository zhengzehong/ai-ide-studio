import { lazy, Suspense, useEffect } from 'react'
import { Bot, Loader2, MessagesSquare } from 'lucide-react'
import { useGlobalAssistantStore } from '../../stores/global-assistant.store'
import { useSessionDockStore } from '../../stores/session-dock.store'
import { agentAvatar, agentColor } from '../../pages/workspace/helpers'
import { ICON_MAP } from '../agent-square/constants'
import { SessionDockDrawer } from '../session-dock/SessionDockDrawer'
import { useProjectedSessionDockItems } from '../session-dock/session-dock-team'
import '../session-dock/session-dock.css'

const GlobalAssistantDrawer = lazy(() => import('./GlobalAssistantDrawer').then((module) => ({
  default: module.GlobalAssistantDrawer,
})))
export function GlobalAssistantRail() {
  const assistant = useGlobalAssistantStore((state) => state.assistant)
  const agent = useGlobalAssistantStore((state) => state.agent)
  const open = useGlobalAssistantStore((state) => state.open)
  const loading = useGlobalAssistantStore((state) => state.loading)
  const running = useGlobalAssistantStore((state) => state.running)
  const unread = useGlobalAssistantStore((state) => state.unread)
  const load = useGlobalAssistantStore((state) => state.load)
  const openDrawer = useGlobalAssistantStore((state) => state.openDrawer)
  const closeDrawer = useGlobalAssistantStore((state) => state.closeDrawer)
  const setupListeners = useGlobalAssistantStore((state) => state.setupListeners)
  const dockOpen = useSessionDockStore((state) => state.open)
  // 计数与坞抽屉同口径：团队线按线级运行/未读计入。
  const dockItems = useProjectedSessionDockItems()
  const loadDock = useSessionDockStore((state) => state.load)
  const openDock = useSessionDockStore((state) => state.openDrawer)
  const closeDock = useSessionDockStore((state) => state.closeDrawer)
  const setupDockListeners = useSessionDockStore((state) => state.setupListeners)

  useEffect(() => {
    const cleanup = setupListeners()
    const cleanupDock = setupDockListeners()
    void load()
    void loadDock()
    return () => {
      cleanup()
      cleanupDock()
    }
  }, [load, loadDock, setupDockListeners, setupListeners])

  const dockRunning = dockItems.some((item) => item.activityState === 'running')
  const dockUnreadCount = dockItems.filter((item) => item.unread).length

  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <GlobalAssistantDrawer />
        </Suspense>
      )}
      <SessionDockDrawer />
      <aside className="global-assistant-rail">
        <button
          type="button"
          className={`global-assistant-avatar${open ? ' global-assistant-avatar--active' : ''}`}
          title={agent ? `全局助理：${agent.name}` : '设置全局助理'}
          onClick={() => {
            closeDock()
            void openDrawer()
          }}
        >
          {agent ? (
            <span
              className="global-assistant-avatar-text"
              style={{ background: agentColor(agent) }}
            >
              <GlobalAssistantAvatar agent={agent} size={28} />
            </span>
          ) : loading ? (
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Bot size={18} />
          )}
          {running && <span className="global-assistant-state global-assistant-state--running" />}
          {!running && unread && <span className="global-assistant-state global-assistant-state--unread" />}
        </button>
        <SessionDockLauncher
          open={dockOpen}
          running={dockRunning}
          unreadCount={dockUnreadCount}
          onClick={() => {
            closeDrawer()
            if (dockOpen) closeDock()
            else void openDock()
          }}
        />
        {(assistant || dockItems.length > 0) && <div className="global-assistant-rail-line" />}
      </aside>
    </>
  )
}

export function SessionDockLauncher({
  open,
  running,
  unreadCount,
  onClick,
}: {
  open: boolean
  running: boolean
  unreadCount: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`global-assistant-avatar session-dock-rail-button${open ? ' global-assistant-avatar--active' : ''}`}
          title="置顶会话"
          aria-label="置顶会话"
      onClick={onClick}
    >
      <MessagesSquare size={18} />
      {running && <span className="global-assistant-state session-dock-state-dot" />}
      {unreadCount > 0 && (
        <span className="session-dock-unread-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
      )}
    </button>
  )
}

function GlobalAssistantAvatar({ agent, size }: { agent: { name: string; avatar_url?: string | null; icon?: string }; size: number }) {
  const result = agentAvatar(agent as never)
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
