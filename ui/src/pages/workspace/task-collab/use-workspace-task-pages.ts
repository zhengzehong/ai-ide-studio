import { useCallback, useEffect, useRef, useState } from 'react'
import { queryClient } from '../../../services/query-client'
import { wsClient } from '../../../services/ws-client'
import { useConnectionStore } from '../../../stores/connection.store'
import type { TaskData } from '../../../stores/task.store'
import type { TaskTimeTab } from './task-helpers'
import {
  appendWorkspaceTaskPage,
  completeWorkspaceTaskPageLoad,
  createWorkspaceTaskPages,
  patchWorkspaceTaskPages,
  requestWorkspaceTaskRefresh,
  replaceWorkspaceTaskPage,
  setWorkspaceTaskPageError,
  setWorkspaceTaskPageLoading,
  shouldStartWorkspaceTaskPageLoad,
  workspaceTaskPageQuery,
  type WorkspaceTaskPages,
} from './workspace-task-page-state'

export interface WorkspaceTaskPagesView {
  pages: WorkspaceTaskPages
  loadMore: (tab: TaskTimeTab) => void
  reload: (tab: TaskTimeTab) => void
}

export function useWorkspaceTaskPages(
  projectId: string | undefined,
  hideCompleted: boolean,
): WorkspaceTaskPagesView {
  const connected = useConnectionStore((state) => state.connected)
  const [pages, setPages] = useState<WorkspaceTaskPages>(() => createWorkspaceTaskPages())
  const pagesRef = useRef(pages)
  const requestSequence = useRef<Record<TaskTimeTab, number>>({ today: 0, history: 0 })
  const controllers = useRef<Partial<Record<TaskTimeTab, AbortController>>>({})
  const inFlight = useRef<Record<TaskTimeTab, boolean>>({ today: false, history: false })
  const refreshPending = useRef<Record<TaskTimeTab, boolean>>({ today: false, history: false })
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  const loadPage = useCallback(async (tab: TaskTimeTab, append: boolean): Promise<void> => {
    if (!projectId || !connected) return
    const current = pagesRef.current[tab]
    if (!shouldStartWorkspaceTaskPageLoad({
      append,
      inFlight: inFlight.current[tab],
      hasMore: current.hasMore,
      nextCursor: current.nextCursor,
    })) return

    const sequence = requestSequence.current[tab] + 1
    requestSequence.current[tab] = sequence
    controllers.current[tab]?.abort()
    const controller = new AbortController()
    controllers.current[tab] = controller
    inFlight.current[tab] = true
    setPages((state) => ({
      ...state,
      [tab]: setWorkspaceTaskPageLoading(state[tab], true),
    }))

    const baseQuery = workspaceTaskPageQuery(tab, projectId, hideCompleted)
    try {
      let page
      try {
        page = await queryClient.listTaskPage({
          ...baseQuery,
          ...(append ? { cursor: current.nextCursor ?? undefined } : {}),
          signal: controller.signal,
        })
      } catch (error) {
        if (!append || !isInvalidCursor(error)) throw error
        page = await queryClient.listTaskPage({ ...baseQuery, signal: controller.signal })
        append = false
      }
      if (controller.signal.aborted || requestSequence.current[tab] !== sequence) return
      setPages((state) => ({
        ...state,
        [tab]: append
          ? appendWorkspaceTaskPage(state[tab], page)
          : replaceWorkspaceTaskPage(state[tab], page),
      }))
    } catch (error) {
      if (controller.signal.aborted || requestSequence.current[tab] !== sequence) return
      setPages((state) => ({
        ...state,
        [tab]: setWorkspaceTaskPageError(
          state[tab],
          error instanceof Error ? error.message : '任务加载失败',
        ),
      }))
    } finally {
      if (requestSequence.current[tab] === sequence) {
        inFlight.current[tab] = false
        const transition = completeWorkspaceTaskPageLoad({ pending: refreshPending.current[tab] })
        refreshPending.current[tab] = transition.pending
        if (transition.shouldStart) void loadPage(tab, false)
      }
    }
  }, [connected, hideCompleted, projectId])

  useEffect(() => {
    controllers.current.today?.abort()
    controllers.current.history?.abort()
    inFlight.current = { today: false, history: false }
    refreshPending.current = { today: false, history: false }
    const empty = createWorkspaceTaskPages()
    pagesRef.current = empty
    setPages(empty)
  }, [hideCompleted, projectId])

  useEffect(() => {
    if (!connected || !projectId) return
    const activeControllers = controllers.current
    const activeRequestSequence = requestSequence.current
    const activeInFlight = inFlight.current
    const activeRefreshPending = refreshPending.current
    void loadPage('today', false)
    void loadPage('history', false)
    return () => {
      for (const tab of ['today', 'history'] as const) {
        activeControllers[tab]?.abort()
        activeRequestSequence[tab] += 1
        activeInFlight[tab] = false
        activeRefreshPending[tab] = false
      }
    }
  }, [connected, loadPage, projectId])

  useEffect(() => {
    const unsubscribe = wsClient.on('task:update', (message) => {
      if (!projectId || typeof message.taskId !== 'string' || !isRecord(message.data)) return
      const patch = { ...message.data, id: message.taskId } as Partial<TaskData> & { id: string; event?: string }
      setPages((state) => patchWorkspaceTaskPages(state, patch, projectId, hideCompleted))
    })
    return () => { unsubscribe() }
  }, [hideCompleted, projectId])

  useEffect(() => {
    if (!projectId) return
    const refresh = (): void => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null
        for (const tab of ['today', 'history'] as const) {
          const transition = requestWorkspaceTaskRefresh({
            inFlight: inFlight.current[tab],
            pending: refreshPending.current[tab],
          })
          refreshPending.current[tab] = transition.pending
          if (transition.shouldStart) void loadPage(tab, false)
        }
      }, 100)
    }
    const offReconnect = wsClient.on('reconnected', refresh)
    const offResync = wsClient.on('resync_required', refresh)
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current)
        refreshTimer.current = null
      }
      offReconnect()
      offResync()
    }
  }, [loadPage, projectId])

  return {
    pages,
    loadMore: (tab) => { void loadPage(tab, true) },
    reload: (tab) => { void loadPage(tab, false) },
  }
}

function isInvalidCursor(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('cursor')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
