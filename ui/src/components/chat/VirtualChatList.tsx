import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { calculateVirtualRange } from './virtual-range'

export const DEFAULT_CHAT_LIST_PADDING_BOTTOM = 16

interface VirtualChatListProps<T> {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  scrollRef: React.RefObject<HTMLDivElement | null>
  estimateHeight?: number
  overscan?: number
  gap?: number
  paddingBottom?: number
  threshold?: number
  onContentResize?: () => void
}

export function VirtualChatList<T>({
  items,
  getKey,
  renderItem,
  scrollRef,
  estimateHeight = 112,
  overscan = 8,
  gap = 14,
  paddingBottom = DEFAULT_CHAT_LIST_PADDING_BOTTOM,
  threshold = 30,
  onContentResize,
}: VirtualChatListProps<T>) {
  const heightsRef = useRef(new Map<number, number>())
  const [heights, setHeights] = useState(() => new Map<number, number>())
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })

  const updateViewport = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setViewport({ scrollTop: el.scrollTop, height: el.clientHeight })
  }, [scrollRef])

  useEffect(() => {
    updateViewport()
    const el = scrollRef.current
    if (!el) return undefined
    el.addEventListener('scroll', updateViewport, { passive: true })
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(el)
    return () => {
      el.removeEventListener('scroll', updateViewport)
      resizeObserver.disconnect()
    }
  }, [scrollRef, updateViewport])

  useEffect(() => {
    updateViewport()
    onContentResize?.()
  }, [items.length, onContentResize, updateViewport])

  const range = useMemo(
    () => calculateVirtualRange(items.length, heights, viewport.scrollTop, viewport.height, estimateHeight + gap, overscan),
    [estimateHeight, gap, heights, items.length, overscan, viewport.height, viewport.scrollTop],
  )

  const resizeObserversRef = useRef(new Map<number, ResizeObserver>())
  const measure = useCallback(
    (index: number, node: HTMLDivElement | null) => {
      const previous = resizeObserversRef.current.get(index)
      if (previous) {
        previous.disconnect()
        resizeObserversRef.current.delete(index)
      }
      if (!node) return
      const resizeObserver = new ResizeObserver(([entry]) => {
        const height = entry.contentRect.height + gap
        if (heightsRef.current.get(index) === height) return
        heightsRef.current.set(index, height)
        setHeights(new Map(heightsRef.current))
        onContentResize?.()
      })
      resizeObserver.observe(node)
      resizeObserversRef.current.set(index, resizeObserver)
    },
    [gap, onContentResize],
  )

  useEffect(() => {
    const observers = resizeObserversRef.current
    return () => {
      observers.forEach((observer) => observer.disconnect())
      observers.clear()
    }
  }, [])

  if (items.length <= threshold) {
    return (
      <>
        {items.map((item) => (
          <div key={getKey(item)} style={{ marginBottom: gap }}>
            {renderItem(item)}
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      <div style={{ height: range.top, flexShrink: 0 }} />
      {items.slice(range.start, range.end).map((item, offset) => {
        const index = range.start + offset
        return (
          <div key={getKey(item)} ref={(node) => measure(index, node)} style={{ marginBottom: gap }}>
            {renderItem(item)}
          </div>
        )
      })}
      <div style={{ height: range.bottom + paddingBottom, flexShrink: 0 }} />
    </>
  )
}
