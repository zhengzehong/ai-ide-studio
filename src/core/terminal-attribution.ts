import { isAutonomousTurnMessageId } from '../shared/autonomous-turn.js'

/**
 * 终帧归属判定(纯函数,可单测)。
 *
 * 背景与三场景契约(2026-09-17 sess-d83044f2 事故 + 双审修复轮):
 *
 * - 事故场景:pendingMessageId === eventMessageId(auto-* 合成回合自带内容)→ 事件 id 赢,
 *   刚启动的真回合行不许动(旧实现的无条件 process 优先会把内容写到 B 回合行上)。
 * - 异 id done + 无活跃过程(processMessageId === undefined)且 pending 有内容 → 信任 pending:
 *   唯一在飞的回合已结算,pending 就是本回合的终稿(集成契约:done 携带 `done-<sid>` 这类
 *   合成 id 时,流式行才是真正的落库行 —— tests/integration/session-done-error.test.ts)。
 * - 事件 id 无对应行 + 有活跃过程(exit- 与 done- 前缀的合成 id)→ 回落 processMessageId:
 *   真实行必须置终态,严禁为合成 id 新建"幽灵行"(二审 B1:进程退出终帧);
 *   auto-* 不适用(自主回合还没建行,回落会误伤已翻转到真实行的 pending,P1-R1)。
 * - 迟到 done(事件=旧行 id,新回合已接管)→ 事件 id 赢,新回合的 pending/过程内容不得外溢。
 *
 * 内容来源与归属行强绑定:只有与目标行同 messageId 的聚合才能写进去。
 */
export interface TerminalAttributionInput {
  /** session:done 事件自带的 messageId。 */
  eventMessageId: string
  /** 当前活跃执行过程(completeTurnProcess)返回的 messageId,可能是另一个回合的。 */
  processMessageId?: string
  /** 是否存在待终稿聚合(turn-finalizer pending)。 */
  hasPendingContent: boolean
  /** 待终稿聚合自身的 messageId(可能 undefined:聚合由无 id 的帧建立)。 */
  pendingMessageId?: string
  /** 事件 messageId 在 messages 表是否已有对应行(合成 id 通常没有)。 */
  eventRowExists: boolean
}

/** 目标行的来源,便于日志区分归属路径。 */
export type TerminalAttributionSource = 'event' | 'pending' | 'process'

export interface TerminalAttribution {
  /** 终态必须写入的消息行 id。 */
  messageId: string
  /** 事件 id 与活跃过程 id 不一致(需告警留痕)。 */
  mismatch: boolean
  source: TerminalAttributionSource
  /** 允许使用活跃过程聚合的内容(processResult.finalAnswer)。 */
  useProcessContent: boolean
  /** 允许使用待终稿聚合的内容(pending 的 content/toolCalls/thinking)。 */
  usePendingContent: boolean
}

export function resolveTerminalAttribution(input: TerminalAttributionInput): TerminalAttribution {
  const { eventMessageId, processMessageId, hasPendingContent, pendingMessageId } = input
  const messageId = resolveTargetMessageId(input)
  const source: TerminalAttributionSource = messageId === eventMessageId
    ? 'event'
    : messageId === processMessageId
      ? 'process'
      : 'pending'
  return {
    messageId,
    mismatch: processMessageId !== undefined && processMessageId !== eventMessageId,
    source,
    useProcessContent: processMessageId !== undefined && processMessageId === messageId,
    usePendingContent: hasPendingContent && (pendingMessageId === undefined || pendingMessageId === messageId),
  }
}

function resolveTargetMessageId(input: TerminalAttributionInput): string {
  const { eventMessageId, processMessageId, hasPendingContent, pendingMessageId, eventRowExists } = input
  // 1) 事件 id 自己有内容(事故 auto-* 或正常回合):事件 id 赢。
  if (pendingMessageId === eventMessageId) return eventMessageId
  // 2) 无活跃过程:在飞的回合已结算,pending 即本回合终稿。
  //    前提补充(F3):"无活跃过程 ≠ 没有在飞回合"—— 合成(auto-*)回合不注册执行过程,
  //    若此时来一个异 id 迟到 done,pending(属于在飞的合成回合)会成为归属行;行为与基线一致。
  if (processMessageId === undefined && hasPendingContent) return pendingMessageId ?? eventMessageId
  // 3) 事件 id 不是消息行(无对应行)且仍有活跃过程:回落真实行,禁止幽灵行。
  //    仅限 exit-/done- 前缀的合成 id:auto-* 是"还没建行的自主回合",不能回落 ——
  //    自主回合在飞 + 新提示到达时 pending.id 可能已翻转为真实行 R(P1-R1),
  //    回落会把 R 提前终态化(与原事故同症状);auto-* 一律走 ④(事件 id 赢、不碰真实行)。
  if (!eventRowExists && processMessageId !== undefined && !isAutonomousTurnMessageId(eventMessageId)) {
    return processMessageId
  }
  // 4) 默认:事件 id 赢(迟到 done 不得把新回合内容写到旧行)。
  return eventMessageId
}
