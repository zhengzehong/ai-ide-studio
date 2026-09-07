interface PromptOriginInput {
  source: 'user' | 'platform'
  options: { originDeviceId?: string; senderRole?: string }
}

const activeOrigins = new Map<string, { turnId: string; deviceId: string | undefined; guest: boolean }>()

export function beginDeviceOrigin(sessionId: string, turnId: string, inputs: PromptOriginInput[]): void {
  const users = inputs.filter((input) => input.source === 'user')
  const ids = new Set(users.map((input) => input.options.originDeviceId))
  activeOrigins.set(sessionId, { turnId, deviceId: ids.size === 1 ? users[0]?.options.originDeviceId : undefined,
    guest: inputs.some((input) => input.options.senderRole === 'guest') })
}

export function endDeviceOrigin(sessionId: string, turnId: string): void {
  if (activeOrigins.get(sessionId)?.turnId === turnId) activeOrigins.delete(sessionId)
}

export function getCurrentOriginDeviceId(sessionId?: string): string | undefined {
  return sessionId ? activeOrigins.get(sessionId)?.deviceId : undefined
}

export function assertDeviceToolOwner(sessionId?: string): void {
  if (!sessionId || !activeOrigins.has(sessionId) || activeOrigins.get(sessionId)?.guest) {
    throw new Error('设备工具仅可由当前正在执行的非访客会话调用')
  }
}
