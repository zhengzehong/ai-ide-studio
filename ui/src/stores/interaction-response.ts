export type InteractionResponseKind = 'permission' | 'elicitation'

export interface InteractionResponseFailure {
  expired: boolean
  message: string
}

export function interactionResponseFailure(
  error: unknown,
  kind: InteractionResponseKind,
): InteractionResponseFailure {
  const detail = error instanceof Error ? error.message : String(error)
  const expired = detail.includes(kind === 'permission' ? '权限请求已失效' : '提问请求已失效')
  if (expired) return { expired: true, message: '权限请求已失效，请重新发送消息' }
  return {
    expired: false,
    message: `${kind === 'permission' ? '权限响应' : '提问响应'}失败：${detail || '请重试'}`,
  }
}
