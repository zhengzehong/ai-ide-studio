/**
 * 终帧归属判定(纯函数,可单测)。
 *
 * 背景:2026-09-17 sess-d83044f2 卡死事故——后台唤醒(合成)回合被 dispose 时发布的
 * 终帧(session:done,messageId=auto-*)进入 finalize 流程后,行 id 取自"当前活跃执行过程"
 * 的 messageId(刚启动的真回合),导致 A 回合的内容/终态写到 B 回合的行上,B 回合行
 * 96ms 内被误置 completed。修复原则:
 *
 * 1. 事件自带的 messageId 是唯一权威归属,任何"当前回合"状态都不得覆盖它;
 * 2. 内容/过程产物只能来自与归属行同 messageId 的聚合(跨回合聚合一律弃用);
 * 3. 归属不一致必须留痕(mismatch=true),便于观测"终帧迟到/错位"而非静默吞掉。
 */
export interface TerminalAttributionInput {
  /** session:done 事件自带的 messageId(权威归属)。 */
  eventMessageId: string
  /** 当前活跃执行过程(completeTurnProcess)返回的 messageId,可能是另一个回合的。 */
  processMessageId?: string
  /** 是否存在待终稿聚合(turn-finalizer pending)。 */
  hasPendingContent: boolean
  /** 待终稿聚合自身的 messageId(可能 undefined:聚合由无 id 的帧建立)。 */
  pendingMessageId?: string
}

export interface TerminalAttribution {
  /** 终态必须写入的消息行 id。 */
  messageId: string
  /** 事件 messageId 与活跃过程 messageId 不一致(需告警留痕)。 */
  mismatch: boolean
  /** 允许使用活跃过程聚合的内容(processResult.finalAnswer)。 */
  useProcessContent: boolean
  /** 允许使用待终稿聚合的内容(pending 的 content/toolCalls/thinking)。 */
  usePendingContent: boolean
}

export function resolveTerminalAttribution(input: TerminalAttributionInput): TerminalAttribution {
  const { eventMessageId, processMessageId, hasPendingContent, pendingMessageId } = input
  return {
    messageId: eventMessageId,
    mismatch: processMessageId !== undefined && processMessageId !== eventMessageId,
    useProcessContent: processMessageId !== undefined && processMessageId === eventMessageId,
    usePendingContent: hasPendingContent && (pendingMessageId === undefined || pendingMessageId === eventMessageId),
  }
}
