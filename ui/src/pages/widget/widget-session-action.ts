import type { WidgetAgentActivityItem } from '../../stores/widget.store'
import type { WidgetNavigationResult } from './types'

type OpenMain = (target: { projectId?: string | null; sessionId?: string | null }) => Promise<WidgetNavigationResult>
type MarkRead = (sessionId: string) => Promise<void>

export async function openWidgetSession(
  session: Pick<WidgetAgentActivityItem, 'sessionId' | 'projectId' | 'unread'>,
  openMain: OpenMain,
  markRead: MarkRead,
): Promise<string | null> {
  try {
    const result = await openMain({ projectId: session.projectId, sessionId: session.sessionId })
    if (!result.ok) return result.error || '无法打开目标会话'
    if (session.unread) await markRead(session.sessionId)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
