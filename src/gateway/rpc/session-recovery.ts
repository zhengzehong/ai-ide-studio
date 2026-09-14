import { getQueryPort } from '../../queries/query-port-provider.js'
import { eventStore, messageStore } from '../../store/sessions.js'
import { pageTurnEvents, resolveTurnEventPageBudget } from '../../queries/turn-event-page.js'
import { createChildLogger } from '../../core/logger.js'
import type { RpcHandlerMap } from './types.js'

const log = createChildLogger('rpc:session-recovery')

export const sessionRecoveryRpcHandlers: RpcHandlerMap = {
  async 'sessions.recovery'(msg, { state, sendResult }) {
    if (state.authMode !== 'owner') throw new Error('仅所有者可恢复会话')
    if (typeof msg.sessionId !== 'string' || !msg.sessionId.trim()) throw new Error('缺少会话 ID')
    sendResult(await getQueryPort().getSessionRecovery({
      sessionId: msg.sessionId,
      limit: typeof msg.limit === 'number' ? msg.limit : undefined,
    }))
  },
  'sessions.messageEventsPage'(msg, { state, sendResult }) {
    if (state.authMode !== 'owner') throw new Error('仅所有者可恢复会话')
    const message = typeof msg.messageId === 'string' ? messageStore.get(msg.messageId) : undefined
    if (!message || message.session_id !== msg.sessionId || message.role !== 'agent') throw new Error('消息不存在')
    const after = cursor(msg.afterSequence, 0)
    const through = cursor(msg.throughSequence, eventStore.latestSequence(message.session_id))
    // 分页预算按端传入(移动端放宽单帧),服务端收敛到上限内。
    const budget = resolveTurnEventPageBudget({ maxItems: budgetValue(msg.maxItems), maxBytes: budgetValue(msg.maxBytes) })
    const page = pageTurnEvents(eventStore.listByMessage(message.session_id, message.id), after, through, budget)
    log.debug({ sessionId: message.session_id, messageId: message.id, count: page.items.length, after, through, budget }, 'Turn recovery page loaded')
    sendResult(page)
  },
}

function cursor(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('恢复游标无效')
  return value
}

function budgetValue(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('分页预算无效')
  return value
}
