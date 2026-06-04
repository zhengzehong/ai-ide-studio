interface IndicatorSession {
  id: string
  status: string
  stage?: string | null
}

export type SessionIndicatorStateMap = Record<string, true>

export interface SessionIndicatorView {
  color: string
  pulse: boolean
  title: string
}

const RUNNING_STAGE_TEXTS = new Set([
  '正在准备 Agent...',
  '正在启动 Agent...',
  'Agent 已就绪',
  '正在连接会话...',
  '正在恢复会话...',
  '会话已连接',
  '正在思考...',
])

export function isRunningStage(stage?: string | null): boolean {
  return !!stage && RUNNING_STAGE_TEXTS.has(stage)
}

export function sessionIndicator(
  session: IndicatorSession,
  runningSessionIds: SessionIndicatorStateMap,
  unreadSessionIds: SessionIndicatorStateMap,
): SessionIndicatorView {
  if (runningSessionIds[session.id]) return { color: 'var(--green)', pulse: true, title: '正在执行' }
  if (unreadSessionIds[session.id]) return { color: 'var(--yellow)', pulse: false, title: '有新回复' }
  if (session.status === 'active') return { color: 'var(--green)', pulse: false, title: '可用' }
  return { color: 'var(--text-3)', pulse: false, title: '已关闭' }
}

export function inferRunningSessionsFromStages(sessions: IndicatorSession[]): SessionIndicatorStateMap {
  return Object.fromEntries(
    sessions.filter((session) => isRunningStage(session.stage)).map((session) => [session.id, true]),
  ) as SessionIndicatorStateMap
}

export function removeSessionIndicator(
  source: SessionIndicatorStateMap,
  sessionId: string,
): SessionIndicatorStateMap {
  if (!source[sessionId]) return source
  const next = { ...source }
  delete next[sessionId]
  return next
}
