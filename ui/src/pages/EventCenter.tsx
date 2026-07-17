import { useEffect } from 'react'
import { Inbox } from 'lucide-react'
import { useProjectScopeId } from '../hooks/use-project-scope'
import { useConnectionStore } from '../stores/connection.store'
import { useEventCenterStore } from '../stores/event-center.store'
import { useProjectViewStateStore } from '../stores/project-view-state.store'
import { EventInboxPanel } from './event-center/EventInboxPanel'
import { CategoryPanel } from './event-center/CategoryPanel'
import { SubscriptionPanel } from './event-center/SubscriptionPanel'
import './event-center/event-center.css'

type Tab = 'events' | 'categories' | 'subscriptions'

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'events', label: '事件中心' },
  { key: 'categories', label: '事件类别' },
  { key: 'subscriptions', label: '订阅规则' },
]

export default function EventCenter() {
  const connected = useConnectionStore((s) => s.connected)
  const currentProjectId = useProjectScopeId()
  const fetchCategories = useEventCenterStore((s) => s.fetchCategories)
  const fetchEvents = useEventCenterStore((s) => s.fetchEvents)
  const fetchSubscriptions = useEventCenterStore((s) => s.fetchSubscriptions)
  const setupListeners = useEventCenterStore((s) => s.setupListeners)
  const tab = useProjectViewStateStore((state) => state.byProjectId[currentProjectId]?.events?.tab ?? 'events')
  const patchEvents = useProjectViewStateStore((state) => state.patchEvents)

  useEffect(() => {
    if (!connected) return
    void fetchCategories(currentProjectId ?? undefined).catch(() => undefined)
    void fetchEvents(currentProjectId)
    void fetchSubscriptions(currentProjectId ?? undefined).catch(() => undefined)
  }, [connected, currentProjectId, fetchCategories, fetchEvents, fetchSubscriptions])

  useEffect(() => setupListeners(), [setupListeners])

  return (
    <div className="ec-page">
      <header className="ec-header">
        <div className="ec-title">
          <span className="ec-title-icon"><Inbox size={18} /></span>
          <div>
            <h1>事件中心</h1>
            <p>收集信号、分发给订阅 Agent，再决定忽略、消费或转成任务。</p>
          </div>
        </div>
        <nav className="ec-tabs">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? 'active' : ''}
              onClick={() => patchEvents(currentProjectId, { tab: item.key })}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="ec-body">
        {tab === 'events' && <EventInboxPanel projectId={currentProjectId} />}
        {tab === 'categories' && <CategoryPanel projectId={currentProjectId} />}
        {tab === 'subscriptions' && <SubscriptionPanel projectId={currentProjectId} />}
      </main>
    </div>
  )
}
