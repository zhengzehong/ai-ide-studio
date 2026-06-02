export interface VirtualRange {
  start: number
  end: number
  top: number
  bottom: number
}

export function calculateVirtualRange(
  count: number,
  heights: Map<number, number>,
  scrollTop: number,
  viewportHeight: number,
  estimateHeight = 96,
  overscan = 6,
): VirtualRange {
  if (count <= 0) return { start: 0, end: 0, top: 0, bottom: 0 }
  const offsets: number[] = [0]
  for (let index = 0; index < count; index += 1) {
    offsets[index + 1] = offsets[index] + (heights.get(index) ?? estimateHeight)
  }

  let start = 0
  while (start < count - 1 && offsets[start + 1] < scrollTop) start += 1
  let end = start
  const viewportBottom = scrollTop + viewportHeight
  while (end < count && offsets[end] < viewportBottom) end += 1

  start = Math.max(0, start - overscan)
  end = Math.min(count, end + overscan)
  return {
    start,
    end,
    top: Math.max(0, offsets[start]),
    bottom: Math.max(0, offsets[count] - offsets[end]),
  }
}