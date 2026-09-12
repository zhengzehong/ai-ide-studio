import { useCallback, useState, type ReactElement } from 'react'
import { Pin, RefreshCw } from 'lucide-react'
import { InteractionPanel } from '../global-assistant/GlobalAssistantInteractions'
import type { ConversationPaneProps } from './conversation-types'
import { ConversationComposer } from './ConversationComposer'
import { ConversationMessageList } from './ConversationMessageList'
import { TeamActivityBar } from '../team/TeamActivityBar'
import { useTeamActivity } from '../team/team-activity-view'
import './conversation-pane.css'

export function ConversationPane({ adapter, onOpenPreview, onOpenFiles, onOpenResource, onTogglePin, pinned, compactTeam = false }: ConversationPaneProps): ReactElement {
  const activity = useTeamActivity(adapter, compactTeam)
  const [location, setLocation] = useState<{ messageId: string; request: number }>()
  const locate = useCallback((messageId: string): void => {
    setLocation(current => ({ messageId, request: (current?.request || 0) + 1 }))
  }, [])
  return <main className="conversation-pane" data-conversation-pane>
    <header className="conversation-header">
      <div className="conversation-target">
        <div className="conversation-agent-avatar">{(adapter.agentName || 'A').charAt(0).toUpperCase()}</div>
        <div>
          <div className="conversation-title"><strong>{adapter.agentName || 'Agent'}</strong>{adapter.sessionTitle && <><span>·</span><span>{adapter.sessionTitle}</span></>}</div>
          <div className="conversation-subtitle">{adapter.agentRuntime || 'runtime'} · {adapter.running ? '运行中' : '空闲'}{adapter.projectId ? ` · ${adapter.projectId}` : ''}</div>
        </div>
      </div>
      <div className="conversation-actions">
        {onTogglePin && <button type="button" className={pinned ? 'is-active' : ''} onClick={onTogglePin} title={pinned ? '取消置顶' : '置顶会话'}><Pin size={14} /></button>}
        {adapter.reload && <button type="button" onClick={() => { void adapter.reload?.() }} title="重新加载消息"><RefreshCw size={14} /></button>}
      </div>
    </header>
    <ConversationMessageList adapter={adapter} compactTeam={compactTeam} location={location} onSeen={activity.markSeen} onOpenPreview={onOpenPreview} onOpenFiles={onOpenFiles} onOpenResource={onOpenResource} />
    {(adapter.pendingPermissions.length > 0 || adapter.pendingElicitations.length > 0 || adapter.interactionError) && <div className="conversation-interactions">
      {adapter.interactionError && <div className="conversation-interaction-error">{adapter.interactionError}</div>}
      <InteractionPanel permission={adapter.pendingPermissions[0]} elicitation={adapter.pendingPermissions.length === 0 ? adapter.pendingElicitations[0] : undefined} onRespondPermission={adapter.respondPermission} onRespondElicitation={adapter.respondElicitation} />
    </div>}
    {compactTeam && <TeamActivityBar members={activity.members} onLocate={locate} />}
    <ConversationComposer key={adapter.sessionId ?? 'empty'} adapter={adapter} />
  </main>
}
