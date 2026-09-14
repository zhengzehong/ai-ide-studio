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
  scrollTarget?: { key: string; request: number }
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
  scrollTarget,
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
  const navigationItems = useRef({ items, getKey, estimateHeight, gap })
  useEffect(() => { navigationItems.current = { items, getKey, estimateHeight, gap } }, [items, getKey, estimateHeight, gap])
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !scrollTarget) return
    const current = navigationItems.current
    const index = current.items.findIndex(item => current.getKey(item) === scrollTarget.key)
    if (index < 0) return
    let offset = 0
    for (let i = 0; i < index; i++) offset += heightsRef.current.get(i) ?? current.estimateHeight + current.gap
    root.scrollTo({ top: offset, behavior: 'instant' })
    updateViewport()
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const node = [...root.querySelectorAll<HTMLElement>('[data-chat-key]')].find(item => item.dataset.chatKey === scrollTarget.key)
        if (!node) return
        root.scrollTo({ top: root.scrollTop + node.getBoundingClientRect().top - root.getBoundingClientRect().top - 12, behavior: 'instant' })
        node.animate([{ outline: '2px solid var(--blue)' }, { outline: '2px solid transparent' }], { duration: 1000 })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollTarget, scrollRef, updateViewport])
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

  const plainContentRef = useRef<HTMLDivElement>(null)
  const plainMode = items.length <= threshold
  // 非虚拟路径（items ≤ threshold）没有 measure() 的逐项 ResizeObserver：图片、工具块、提示词
  // 面板等异步撑高无人修正。补一个内容高度观察，尺寸变化后交由父级 onContentResize
  // （父级仍以 pinned 为前提决定是否追底，不会打扰用户阅读历史）。
  useEffect(() => {
    const node = plainContentRef.current
    if (!node) return undefined
    const observer = new ResizeObserver(() => onContentResize?.())
    observer.observe(node)
    return () => observer.disconnect()
  }, [plainMode, onContentResize])

  if (items.length <= threshold) {
    return (
      <div ref={plainContentRef}>
        {items.map((item) => (
          <div key={getKey(item)} data-chat-key={getKey(item)} style={{ marginBottom: gap }}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div style={{ height: range.top, flexShrink: 0 }} />
      {items.slice(range.start, range.end).map((item, offset) => {
        const index = range.start + offset
        return (
          <div key={getKey(item)} data-chat-key={getKey(item)} ref={(node) => measure(index, node)} style={{ marginBottom: gap }}>
            {renderItem(item)}
          </div>
        )
      })}
      <div style={{ height: range.bottom + paddingBottom, flexShrink: 0 }} />
    </>
  )
}
