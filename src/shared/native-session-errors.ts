function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export function isNativeSessionRuntime(runtime: string): boolean {
  return runtime === 'claude' || runtime === 'codex'
}

export function isMissingNativeSessionError(error: unknown, runtime: string, sessionId: string): boolean {
  if (!sessionId) return false
  const escapedSessionId = escapeRegExp(sessionId)
  const exactIdBoundary = '(?![a-z0-9_-])'
  const patterns = runtime === 'claude'
    ? [
        `resource not found:\\s*${escapedSessionId}${exactIdBoundary}`,
        `no conversation found with session id\\s*:?\\s*${escapedSessionId}${exactIdBoundary}`,
      ]
    : runtime === 'codex'
      ? [
          `thread not found:\\s*${escapedSessionId}${exactIdBoundary}`,
          `thread\\s+${escapedSessionId}${exactIdBoundary}\\s+not found`,
        ]
      : []
  const message = errorMessage(error)
  return patterns.some((pattern) => new RegExp(pattern, 'i').test(message))
}

export function createMissingNativeSessionHistoryError(sessionId: string): Error {
  return new Error(`底层 Agent 会话历史已丢失，已阻止自动重建以避免丢失上下文。请新建会话继续。Session ID: ${sessionId}`)
}
