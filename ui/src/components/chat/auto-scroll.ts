/** 会话滚动跟随的贴底阈值：与 ConversationMessageList 历史行为一致（100px）。 */
export const SCROLL_FOLLOW_THRESHOLD_PX = 100

/** 重放/内容版本落地后的补偿性再锚定上限：距底不超过它才自动追底（更远一律视为"用户在看历史"）。 */
export const REPLAY_REANCHOR_MAX_PX = 600

/** 指针位移超过它才算"用户拖拽滚动"（滚动条拖拽/触摸拖动）；单纯点击不算，见 ScrollReleaseReason。 */
export const POINTER_DRAG_INTENT_PX = 8

/**
 * 释放跟随的原因：
 * - `manual`：用户真实滚动意图（wheel / touchstart / 按下后位移超阈值 / 滚动条拖拽）——用户在看历史，不得自动拉回；
 * - `upward`：位置被页面自己推着上行而失去贴底（布局重排 / clamp / anchoring 补偿）——可被内容变化后的再锚定救回。
 */
export type ScrollReleaseReason = 'manual' | 'upward'

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
 * - 贴底（≤阈值）→ 跟随，并解除初始定位宽限与释放原因；
 * - 用户主动滚动（manual = wheel/touchstart/按下后位移超阈值后的首个滚动事件）→
 *   立即解除跟随，宽限一并清除，释放原因记为 `manual`；
 * - 上行（scrollTop 小于上一次）：**只有用户确实在拖动（pressed）或此前已由真实滚动释放**
 *   才解除；纯程序性回落（布局重排 / clamp / anchoring 补偿，指针未按下）保持当前跟随状态——
 *   页面自己挤动不该冤杀跟随（治"点进会话后视口被留在半中间"的次要通路）；
 * - 初始定位宽限窗口内（挂载/切会话/重放合并后的高度剧烈变化期）→ 保持既有 pinned，不被剧变降级；
 * - 其余情况走增长豁免：内容高度增长（scrollHeight 变大且非用户上行）不算离开底部
 *   （见 nextPinnedToBottom），否则按裸阈值判 leaving（记为可救回的 `upward`）。
 */
export function resolveScrollFollow(input: {
  pinned: boolean
  grace: boolean
  manual: boolean
  /** 指针是否按下中（滚动条拖拽 / 触摸拖动过程中为真）。 */
  pressed?: boolean
  /** 上一次的释放原因；`manual` 表示用户正在看历史，此后不得自动拉回。 */
  release?: ScrollReleaseReason | null
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }
  previousScrollHeight: number
  previousScrollTop: number
  thresholdPx?: number
}): { pinned: boolean; grace: boolean; release: ScrollReleaseReason | null } {
  const thresholdPx = input.thresholdPx ?? SCROLL_FOLLOW_THRESHOLD_PX
  const release = input.release ?? null
  if (isNearBottom(input.metrics, thresholdPx)) return { pinned: true, grace: false, release: null }
  if (input.manual) return { pinned: false, grace: false, release: 'manual' }
  if (input.metrics.scrollTop < input.previousScrollTop) {
    if (input.pressed || release === 'manual') {
      return { pinned: false, grace: false, release: release === 'manual' ? 'manual' : 'upward' }
    }
    // 程序性回落：保持当前状态（等价宽限分支的"不降级"语义），把判定权交给后续的增长/贴底信号。
    return { pinned: input.pinned, grace: input.grace, release }
  }
  if (input.grace) return { pinned: input.pinned, grace: true, release }
  const pinned = nextPinnedToBottom({
    wasPinned: input.pinned,
    metrics: input.metrics,
    previousScrollHeight: input.previousScrollHeight,
    thresholdPx,
  })
  // `manual` 释放具粘性：用户真滚上去读历史期间不得被改写成可救回的 `upward`
  // （否则后续任何 contentRevision 的再锚定都会把用户拉回底部）；回到近底由上面的近底分支清空。
  return { pinned, grace: false, release: pinned ? null : (release ?? 'upward') }
}

/**
 * 重放/内容版本落地后的补偿性再锚定判定（纯函数）：
 * 释放原因是 `manual`（用户在看历史）时一律不打扰；否则贴底或距底不超过 maxPx 就重新追底。
 */
export function shouldReanchorAfterContentChange(input: {
  pinned: boolean
  release: ScrollReleaseReason | null
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }
  maxPx?: number
}): boolean {
  if (input.release === 'manual') return false
  if (input.pinned) return true
  return input.metrics.scrollHeight - input.metrics.scrollTop - input.metrics.clientHeight <= (input.maxPx ?? REPLAY_REANCHOR_MAX_PX)
}
