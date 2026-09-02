// 会话归档/还原守卫：与批量操作（session-bulk-actions.ts）同一套判断口径，
// 归档 RPC、还原 RPC 与后续 AI 会话管理工具共用，避免多处逻辑漂移。
export type SessionManageAction = 'archive' | 'restore'

export interface SessionManageCandidate {
  id: string
  is_primary: number | boolean
  status: string
  activity_state?: 'running' | 'idle'
  purpose: string
  archived_at: string | null
  deleted_at: string | null
}

function isSessionRunning(session: SessionManageCandidate): boolean {
  return session.activity_state === 'running'
    || (session.activity_state === undefined && session.status === 'active')
}

export function sessionManageSkipReason(
  session: SessionManageCandidate,
  action: SessionManageAction,
): string | null {
  if (session.deleted_at) return '会话已删除'
  if (session.purpose !== 'conversation') {
    return action === 'archive' ? '系统会话不可归档' : '系统会话不可还原'
  }
  if (action === 'archive') {
    if (session.is_primary) return '主会话不可归档'
    if (isSessionRunning(session)) return '运行中的会话不可归档'
    if (session.archived_at) return '会话已归档'
    return null
  }
  if (!session.archived_at) return '会话未归档'
  return null
}

export function assertSessionManageable(
  session: SessionManageCandidate,
  action: SessionManageAction,
): void {
  const reason = sessionManageSkipReason(session, action)
  if (reason) throw new Error(reason)
}
