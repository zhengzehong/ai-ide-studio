export const WIDGET_WIDTH = 360
export const WIDGET_HEIGHT = 400

const LEGACY_WIDGET_WIDTH = 390
const LEGACY_WIDGET_HEIGHT = 570
const DEFAULT_EDGE_GAP = 20

export interface WidgetSavedBounds {
  x: number
  y: number
  width?: number
  height?: number
}

interface WorkAreaSize {
  width: number
  height: number
}

export function resolveWidgetPosition(
  saved: WidgetSavedBounds | null,
  workArea: WorkAreaSize,
): { x: number; y: number } {
  if (!saved) {
    return {
      x: workArea.width - WIDGET_WIDTH - DEFAULT_EDGE_GAP,
      y: workArea.height - WIDGET_HEIGHT - DEFAULT_EDGE_GAP,
    }
  }

  const previousWidth = saved.width ?? LEGACY_WIDGET_WIDTH
  const previousHeight = saved.height ?? LEGACY_WIDGET_HEIGHT
  return {
    x: resolveAxis(saved.x, previousWidth, WIDGET_WIDTH, workArea.width),
    y: resolveAxis(saved.y, previousHeight, WIDGET_HEIGHT, workArea.height),
  }
}

function resolveAxis(position: number, previousSize: number, nextSize: number, availableSize: number): number {
  const leadingGap = position
  const trailingGap = availableSize - position - previousSize
  const nextPosition = trailingGap < leadingGap
    ? availableSize - nextSize - Math.max(0, trailingGap)
    : Math.max(0, leadingGap)
  return Math.min(Math.max(0, availableSize - nextSize), Math.max(0, nextPosition))
}
