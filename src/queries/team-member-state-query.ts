import type { ElicitationRequestData, PermissionRequestData } from '../types/ws-protocol.js'
import { eventStore, type SessionEventRow } from '../store/sessions.js'

/**
 * 团队面板"轻量恢复"(2026-09-17 会话拉消息治理 P1)。
 *
 * 背景:团队面板切换时对 master + 每个成员各拉一次 `sessions.recovery(limit 500)`。
 * 生产实测每成员 553~896KB / 19~243ms,而前端只消费其中三类信息:
 *   - usage(最后一条 usage.update)
 *   - pendingPermissions / pendingElicitations(未决的 permission/elicitation)
 *   - latestSequence(重放边界)
 * 其余 87%~96% 的字节(历史 message.user、commands.update、config.update、lifecycle.*)
 * 对团队面板毫无用处 —— 消息页与实时订阅已经覆盖了它们。
 *
 * 本查询把它们换成:一条 covering-index 点查(latestSequence)+ 一次"事件尾巴"扫描
 * (取最后 TEAM_MEMBER_STATE_TAIL_EVENTS 条,应用层归约出 usage)+ 一次未决项候选扫描
 * (迁移 075 的部分索引,只覆盖 permission/elicitation 四类)。
 *
 * 生产实测(2026-09-17):尾巴扫描 100 条 中位 1.10ms / 最大 5.66ms;
 * usage.update 距结尾位置中位第 5 条、最远第 17 条,19/20 的会话被尾巴覆盖。
 */
export interface TeamMemberStateSnapshot {
  sessionId: string
  latestSequence: number
  usage: Record<string, unknown> | null
  pendingPermissions: PermissionRequestData[]
  pendingElicitations: ElicitationRequestData[]
}

export interface TeamMemberStateDiagnostics {
  operation: 'sessions.teamMemberState'
  sessionId: string
  latestSequenceMs: number
  tailMs: number
  pendingMs: number
  totalMs: number
  tailEvents: number
  pendingEvents: number
}

export interface TeamMemberStateReadResult {
  snapshot: TeamMemberStateSnapshot
  diagnostics: TeamMemberStateDiagnostics
}

/** 尾巴扫描条数:实测 usage.update 最远在倒数第 17 条,取 100 留 5 倍余量。 */
export const TEAM_MEMBER_STATE_TAIL_EVENTS = 100
/** 未决项候选条数:真正挂起的请求会阻塞该成员回合,不可能埋在 500 条候选之前。 */
export const TEAM_MEMBER_STATE_PENDING_EVENTS = 500

interface TeamMemberStateDependencies {
  latestSequence(sessionId: string): number
  listRecent(sessionId: string, limit: number): SessionEventRow[]
  listPendingCandidates(sessionId: string, limit: number): SessionEventRow[]
  now(): number
}

const defaultDependencies: TeamMemberStateDependencies = {
  latestSequence: (sessionId) => eventStore.latestSequence(sessionId),
  listRecent: (sessionId, limit) => eventStore.listRecent(sessionId, limit),
  listPendingCandidates: (sessionId, limit) => eventStore.listPendingCandidates(sessionId, limit),
  now: () => performance.now(),
}

export function readTeamMemberState(
  input: { sessionId: string; tailEvents?: number; pendingEvents?: number },
  dependencies: TeamMemberStateDependencies = defaultDependencies,
): TeamMemberStateReadResult {
  const tailEvents = input.tailEvents ?? TEAM_MEMBER_STATE_TAIL_EVENTS
  const pendingEvents = input.pendingEvents ?? TEAM_MEMBER_STATE_PENDING_EVENTS
  const startedAt = dependencies.now()
  const latestSequence = dependencies.latestSequence(input.sessionId)
  const latestSequenceAt = dependencies.now()
  const tail = dependencies.listRecent(input.sessionId, tailEvents)
  const tailAt = dependencies.now()
  const pendingCandidates = dependencies.listPendingCandidates(input.sessionId, pendingEvents)
  const completedAt = dependencies.now()
  const pending = reducePendingEvents(pendingCandidates)
  return {
    snapshot: {
      sessionId: input.sessionId,
      latestSequence,
      usage: lastUsage(tail),
      pendingPermissions: pending.pendingPermissions,
      pendingElicitations: pending.pendingElicitations,
    },
    diagnostics: {
      operation: 'sessions.teamMemberState',
      sessionId: input.sessionId,
      latestSequenceMs: latestSequenceAt - startedAt,
      tailMs: tailAt - latestSequenceAt,
      pendingMs: completedAt - tailAt,
      totalMs: completedAt - startedAt,
      tailEvents: tail.length,
      pendingEvents: pendingCandidates.length,
    },
  }
}

/**
 * 未决项归约:与前端 applySessionEvent(ui/src/stores/session-events.ts:826-851)同语义 ——
 * request 按 id 落座(后到的同 id 覆盖),result 按 requestId 撤销。
 * 这里必须走"全量候选 + 归约",不能只挑最后一条 request:请求与结果可能跨越多条事件。
 */
export function reducePendingEvents(events: SessionEventRow[]): {
  pendingPermissions: PermissionRequestData[]
  pendingElicitations: ElicitationRequestData[]
} {
  const permissions = new Map<string, PermissionRequestData>()
  const elicitations = new Map<string, ElicitationRequestData>()
  for (const event of events) {
    const payload = parsePayload(event.payload_json)
    if (!payload) continue
    switch (event.type) {
      case 'permission.request': {
        const request = asRecord(payload.permissionRequest)
        if (typeof request?.id === 'string') permissions.set(request.id, request as unknown as PermissionRequestData)
        break
      }
      case 'permission.result': {
        const requestId = payload.requestId
        if (typeof requestId === 'string') permissions.delete(requestId)
        break
      }
      case 'elicitation.request': {
        const request = asRecord(payload.elicitationRequest)
        if (typeof request?.id === 'string') elicitations.set(request.id, request as unknown as ElicitationRequestData)
        break
      }
      case 'elicitation.result': {
        const requestId = payload.requestId
        if (typeof requestId === 'string') elicitations.delete(requestId)
        break
      }
      default:
        break
    }
  }
  return { pendingPermissions: [...permissions.values()], pendingElicitations: [...elicitations.values()] }
}

/** 尾巴里最后一条 usage.update 的 usage;没有则 null。 */
export function lastUsage(events: SessionEventRow[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'usage.update') continue
    const payload = parsePayload(event.payload_json)
    const usage = asRecord(payload?.usage)
    if (usage) return usage
  }
  return null
}

function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
