/** 会话滚动跟随的贴底阈值：与 ConversationMessageList 历史行为一致（100px）。 */
export const SCROLL_FOLLOW_THRESHOLD_PX = 100

export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  thresholdPx = 160,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx
}

export function nextPinnedToBottom({
  wasPinned,
  metrics,
  previousScrollHeight,
  thresholdPx = 160,
}: {
  wasPinned: boolean
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }
  previousScrollHeight: number
  thresholdPx?: number
}): boolean {
  if (isNearBottom(metrics, thresholdPx)) return true
  if (!wasPinned) return false
  return metrics.scrollHeight > previousScrollHeight
}

/** 流式跟随签名的最小结构（StreamingMessage 子集，避免引入 store 依赖）。 */
export interface StreamingScrollSignatureTurn {
  id: string
  content?: string
  thinking?: string
  processBlocks?: readonly unknown[]
  toolCalls?: ReadonlyArray<{
    id?: string
    status?: string
    terminalOutput?: string
    progress?: readonly string[]
    rawOutput?: unknown
  }>
  stage?: string
}

/**
 * 流式跟随签名：除正文/思考/过程块数量外，还包含末个工具的状态与输出长度——
 * 工具长跑（terminalOutput/progress/rawOutput 持续增长、无新 chunk）时也要触发跟随，
 * 与 Workspace 的 streamingScrollSignature 对齐。
 */
export function streamingScrollSignature(turns: readonly StreamingScrollSignatureTurn[]): string {
  return turns.map((turn) => {
    const lastTool = turn.toolCalls?.at(-1)
    return [
      turn.id,
      turn.content?.length || 0,
      turn.thinking?.length || 0,
      turn.processBlocks?.length || 0,
      turn.toolCalls?.length || 0,
      turn.stage || '',
      lastTool?.id || '',
      lastTool?.status || '',
      lastTool?.terminalOutput?.length || 0,
      lastTool?.progress?.length || 0,
      lastTool?.rawOutput == null ? 0 : typeof lastTool.rawOutput === 'string' ? lastTool.rawOutput.length : 1,
    ].join(':')
  }).join('|')
}

/**
 * 一次滚动事件后的跟随判定（纯函数，供 ConversationMessageList 与单测使用）。
 *
 * 语义：
 * - 贴底（≤阈值）→ 跟随，并解除初始定位宽限；
 * - 用户主动滚动（manual = wheel/touchstart/pointerdown 后的首个滚动事件）或
 *   scrollTop 减小（滚动条拖拽等无 wheel 事件的上行滚动）→ 立即解除跟随，宽限一并清除；
 * - 初始定位宽限窗口内（挂载/切会话后高度剧烈变化期）→ 保持既有 pinned，不被剧变降级；
 * - 其余情况走增长豁免：内容高度增长（scrollHeight 变大且非用户上行）不算离开底部
 *   （见 nextPinnedToBottom），否则按裸阈值判 leaving。
 */
export function resolveScrollFollow(input: {
  pinned: boolean
  grace: boolean
  manual: boolean
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }
  previousScrollHeight: number
  previousScrollTop: number
  thresholdPx?: number
}): { pinned: boolean; grace: boolean } {
  const thresholdPx = input.thresholdPx ?? SCROLL_FOLLOW_THRESHOLD_PX
  if (isNearBottom(input.metrics, thresholdPx)) return { pinned: true, grace: false }
  if (input.manual) return { pinned: false, grace: false }
  if (input.metrics.scrollTop < input.previousScrollTop) return { pinned: false, grace: false }
  if (input.grace) return { pinned: input.pinned, grace: true }
  return {
    pinned: nextPinnedToBottom({
      wasPinned: input.pinned,
      metrics: input.metrics,
      previousScrollHeight: input.previousScrollHeight,
      thresholdPx,
    }),
    grace: false,
  }
}
