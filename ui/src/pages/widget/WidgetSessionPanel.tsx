import { useState } from 'react'
import { Bot, RefreshCw } from 'lucide-react'
import { ICON_MAP, type IconName } from '../../components/agent-square/constants'
import { useWidgetStore, type WidgetSessionItem } from '../../stores/widget.store'
import { formatTimeAgo } from './format'
import { styles } from './styles'
import { electronApi } from './types'
import { openWidgetSession } from './widget-session-action'

export function WidgetSessionPanel() {
  const sessions = useWidgetStore((s) => s.sessions)
  const sessionsLoading = useWidgetStore((s) => s.sessionsLoading)
  const sessionsError = useWidgetStore((s) => s.sessionsError)
  const pinnedProjectId = useWidgetStore((s) => s.preferences.pinnedProjectId)
  const markSessionRead = useWidgetStore((s) => s.markSessionRead)
  const fetchSessions = useWidgetStore((s) => s.fetchSessions)
  const [navigationError, setNavigationError] = useState<string | null>(null)

  const handleSessionClick = async (session: WidgetSessionItem) => {
    setNavigationError(null)
    if (!electronApi) {
      setNavigationError('请在桌面客户端中打开会话')
      return
    }
    setNavigationError(await openWidgetSession(session, electronApi.openMain, markSessionRead))
  }

  return (
    <div style={styles.panelScroll}>
      {(sessionsError || navigationError) && (
        <div style={styles.inlineError} role="alert">
          <span>{navigationError || sessionsError}</span>
          {sessionsError && (
            <button
              style={styles.retryBtn}
              onClick={() => void fetchSessions(pinnedProjectId, 'recent')}
              title="重新同步"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      )}
      {sessionsLoading && sessions.length > 0 && <div style={styles.syncing}>正在同步...</div>}
      {sessionsLoading && sessions.length === 0 ? (
        <div style={styles.empty}>正在同步...</div>
      ) : sessions.length === 0 ? (
        <div style={styles.empty}>暂无运行或最近会话</div>
      ) : (
        sessions.map((session) => (
          <SessionRow key={session.sessionId} session={session} onClick={() => void handleSessionClick(session)} />
        ))
      )}
    </div>
  )
}

function SessionRow({ session, onClick }: { session: WidgetSessionItem; onClick: () => void }) {
  const isRunning = session.activityState === 'running'
  const IconComp = session.agentIcon && ICON_MAP[session.agentIcon as IconName]
    ? ICON_MAP[session.agentIcon as IconName]
    : Bot
  const title = session.sessionTitle || session.taskTitle || '未命名会话'
  const description = isRunning
    ? (session.stage || '运行中...')
    : (session.stage || (session.unread ? '有新回复' : '最近已完成'))

  return (
    <div style={styles.agentRow} onClick={onClick}>
      <div style={styles.agentIcon}>
        <IconComp size={14} />
        {isRunning && <span style={styles.liveDot} />}
        {!isRunning && session.unread && <span style={styles.unreadDot} />}
      </div>
      <div style={styles.agentBody}>
        <div style={styles.agentTitleRow}>
          <span style={styles.agentName}>{session.agentName}</span>
          {session.projectName && <span style={styles.agentProject}>{session.projectName}</span>}
        </div>
        <div style={styles.sessionTitle}>{title}</div>
        <div style={{ ...styles.agentDesc, ...(session.unread && !isRunning ? styles.unreadText : {}) }}>
          {description}
        </div>
      </div>
      <div style={styles.agentTime}>
        {isRunning ? '进行中' : formatTimeAgo(session.completedAt || session.lastMessageAt || session.startedAt)}
      </div>
    </div>
  )
}
