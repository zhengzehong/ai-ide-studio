import { useEffect } from 'react'
import { Bot, Loader2 } from 'lucide-react'
import { useGlobalAssistantStore } from '../../stores/global-assistant.store'
import { agentAvatar, agentColor } from '../../pages/workspace/helpers'
import { GlobalAssistantDrawer } from './GlobalAssistantDrawer'

export function GlobalAssistantRail() {
  const assistant = useGlobalAssistantStore((state) => state.assistant)
  const agent = useGlobalAssistantStore((state) => state.agent)
  const open = useGlobalAssistantStore((state) => state.open)
  const loading = useGlobalAssistantStore((state) => state.loading)
  const running = useGlobalAssistantStore((state) => state.running)
  const unread = useGlobalAssistantStore((state) => state.unread)
  const load = useGlobalAssistantStore((state) => state.load)
  const openDrawer = useGlobalAssistantStore((state) => state.openDrawer)
  const setupListeners = useGlobalAssistantStore((state) => state.setupListeners)

  useEffect(() => {
    const cleanup = setupListeners()
    void load()
    return cleanup
  }, [load, setupListeners])

  return (
    <>
      <aside className="global-assistant-rail">
        <button
          type="button"
          className={`global-assistant-avatar${open ? ' global-assistant-avatar--active' : ''}`}
          title={agent ? `全局助理：${agent.name}` : '设置全局助理'}
          onClick={() => { void openDrawer() }}
        >
          {agent ? (
            <span
              className="global-assistant-avatar-text"
              style={{ background: agentColor(agent) }}
            >
              {agentAvatar(agent)}
            </span>
          ) : loading ? (
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Bot size={18} />
          )}
          {running && <span className="global-assistant-state global-assistant-state--running" />}
          {!running && unread && <span className="global-assistant-state global-assistant-state--unread" />}
        </button>
        {assistant && <div className="global-assistant-rail-line" />}
      </aside>
      <GlobalAssistantDrawer />
    </>
  )
}
