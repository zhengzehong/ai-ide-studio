import { Bot } from 'lucide-react'
import { useWidgetStore, type WidgetSessionItem } from '../../stores/widget.store'
import { formatElapsed, formatTimeAgo } from './format'
import { styles } from './styles'
import { electronApi } from './types'

export function WidgetSessionPanel() {
  const sessions = useWidgetStore((s) => s.sessions)
  const markSessionRead = useWidgetStore((s) => s.markSessionRead)

  const handleSessionClick = (session: WidgetSessionItem) => {
    if (session.unread) {
      void markSessionRead(session.sessionId)
    }
    electronApi?.openMain({ projectId: session.projectId, sessionId: session.sessionId })
  }

  return (
    <div style={styles.panelScroll}>
      {sessions.length === 0 ? (
        <div style={styles.empty}>暂无运行或未读会话</div>
      ) : (
        sessions.map((session) => (
          <SessionRow key={session.sessionId} session={session} onClick={() => handleSessionClick(session)} />
        ))
      )}
    </div>
  )
}

function SessionRow({ session, onClick }: { session: WidgetSessionItem; onClick: () => void }) {
  const isRunning = session.activityState === 'running'
  const title = session.sessionTitle || session.taskTitle || '未命名会话'
  const description = isRunning
    ? (session.stage || '运行中...')
    : session.unread
      ? '已完成 · 未读'
      : (session.stage || '空闲')

  return (
    <div style={styles.agentRow} onClick={onClick}>
      <div style={styles.agentIcon}>
        {session.agentIcon ? <span style={{ fontSize: 12 }}>{session.agentIcon}</span> : <Bot size={14} />}
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
        {isRunning ? formatElapsed(session.startedAt) : formatTimeAgo(session.completedAt || session.lastMessageAt || session.startedAt)}
      </div>
    </div>
  )
}
