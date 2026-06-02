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
