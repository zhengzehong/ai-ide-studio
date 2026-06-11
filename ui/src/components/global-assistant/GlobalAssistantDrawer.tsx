import { Bot } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useConnectionStore } from '../../stores/connection.store'
import {
  useGlobalAssistantStore,
  type GlobalAssistantPayload,
} from '../../stores/global-assistant.store'
import { GlobalAssistantChat } from './GlobalAssistantChat'

export function GlobalAssistantDrawer() {
  const navigate = useNavigate()
  const connected = useConnectionStore((state) => state.connected)
  const open = useGlobalAssistantStore((state) => state.open)
  const closeDrawer = useGlobalAssistantStore((state) => state.closeDrawer)
  const payload = useGlobalAssistantPayload()

  return (
    <>
      {open && <div className="global-assistant-backdrop" onClick={closeDrawer} />}
      <section className={`global-assistant-drawer${open ? ' global-assistant-drawer--open' : ''}`}>
        {!payload ? (
          <div className="global-assistant-empty">
            <Bot size={34} />
            <div className="global-assistant-empty-title">还没有设置全局助理</div>
            <div className="global-assistant-empty-text">在 Agent 广场选择一个模板，设为全局助理后就可以随时从右侧唤出。</div>
            <button
              type="button"
              className="global-assistant-primary-btn"
              onClick={() => {
                closeDrawer()
                navigate('/agents')
              }}
            >
              去 Agent 广场
            </button>
          </div>
        ) : (
          <GlobalAssistantChat connected={connected} payload={payload} />
        )}
      </section>
    </>
  )
}

function useGlobalAssistantPayload(): GlobalAssistantPayload | null {
  const assistant = useGlobalAssistantStore((state) => state.assistant)
  const agent = useGlobalAssistantStore((state) => state.agent)
  const session = useGlobalAssistantStore((state) => state.session)
  return assistant && agent && session ? { assistant, agent, session } : null
}
