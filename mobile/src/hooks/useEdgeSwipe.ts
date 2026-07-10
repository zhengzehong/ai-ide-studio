import { useCallback, useRef } from 'react'

const EDGE_WIDTH = 24
const OPEN_THRESHOLD = 40
const CLOSE_THRESHOLD = 40

interface DragState {
  startX: number
  startY: number
  mode: 'open' | 'close'
  dx: number
}

export interface UseEdgeSwipeOptions {
  drawerEl: React.RefObject<HTMLElement | null>
  overlayEl: React.RefObject<HTMLElement | null>
  containerEl: React.RefObject<HTMLElement | null>
  isOpen: boolean
  isPinned: boolean
  onOpen: () => void
  onClose: () => void
}

export interface EdgeSwipeHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
}

function getRect(el: HTMLElement | null): DOMRect | null {
  return el ? el.getBoundingClientRect() : null
}

export function useEdgeSwipe(options: UseEdgeSwipeOptions): EdgeSwipeHandlers {
  const dragRef = useRef<DragState | null>(null)
  const optsRef = useRef(options)
  optsRef.current = options

  const resetStyles = useCallback(() => {
    const drawer = optsRef.current.drawerEl.current
    const overlay = optsRef.current.overlayEl.current
    if (drawer) {
      drawer.style.transition = ''
      drawer.style.transform = ''
    }
    if (overlay) {
      overlay.style.transition = ''
      overlay.style.opacity = ''
      overlay.style.pointerEvents = ''
    }
  }, [])

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const drawer = optsRef.current.drawerEl.current
    const overlay = optsRef.current.overlayEl.current
    if (!drawer) return

    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY

    if (Math.abs(dy) > Math.abs(dx) * 1.5) {
      dragRef.current = null
      resetStyles()
      return
    }

    drag.dx = dx
    const width = drawer.offsetWidth || 1

    if (drag.mode === 'open' && dx > 0) {
      const progress = Math.min(dx / width, 1)
      drawer.style.transition = 'none'
      drawer.style.transform = `translateX(${-width + dx}px)`
      if (overlay) {
        overlay.style.transition = 'none'
        overlay.style.opacity = String(progress * 0.4)
        overlay.style.pointerEvents = 'auto'
      }
    } else if (drag.mode === 'close' && dx < 0) {
      const progress = Math.max(1 + dx / width, 0)
      drawer.style.transition = 'none'
      drawer.style.transform = `translateX(${dx}px)`
      if (overlay) {
        overlay.style.transition = 'none'
        overlay.style.opacity = String(progress * 0.4)
      }
    }
  }, [resetStyles])

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    resetStyles()
    if (drag.mode === 'open' && drag.dx > OPEN_THRESHOLD) {
      optsRef.current.onOpen()
    } else if (drag.mode === 'close' && drag.dx < -CLOSE_THRESHOLD) {
      optsRef.current.onClose()
    }
    dragRef.current = null
  }, [resetStyles])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const { isPinned, isOpen, containerEl, drawerEl } = optsRef.current
    if (isPinned) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const x = e.clientX
    const y = e.clientY

    if (!isOpen) {
      const containerRect = getRect(containerEl.current)
      if (!containerRect) return
      const relX = x - containerRect.left
      if (relX < 0 || relX > EDGE_WIDTH) return
      dragRef.current = { startX: x, startY: y, mode: 'open', dx: 0 }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    } else {
      const drawerRect = getRect(drawerEl.current)
      if (!drawerRect) return
      if (x < drawerRect.left || x > drawerRect.right) return
      dragRef.current = { startX: x, startY: y, mode: 'close', dx: 0 }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    }
  }, [onPointerMove, onPointerUp])

  return { onPointerDown }
}
