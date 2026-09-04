import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { HOTKEY_ACTIONS, dispatchHotkeyAction, subscribeHotkeyActions } from '../../lib/hotkey-actions'
import { bindingFromEvent } from '../../lib/platform-key'
import { resolveHotkey } from '../../lib/hotkey-registry'
import { useHotkeyStore } from '../../stores/hotkey.store'
import { useProjectNavigation } from '../../hooks/use-project-navigation'
import { useProjectStore } from '../../stores/project.store'
import { usePinnedProjects } from '../../utils/project-meta'
import { useSessionStore } from '../../stores/session.store'
import { queryClient } from '../../services/query-client'
import { resolvePinnedProjectId } from '../../lib/hotkey-component-helpers'

function isTextTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return !!element?.closest('input, textarea, select, [contenteditable="true"]')
}

function isModalTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return !!element?.closest('[role="dialog"], [data-hotkey-scope="modal"]')
}

function isListTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return !!element?.closest('[data-hotkey-scope="list"], [data-hotkey-session-list]')
}

function scopeAllows(actionId: string, event: KeyboardEvent): boolean {
  const action = HOTKEY_ACTIONS.find((item) => item.id === actionId)
  if (!action) return false
  if (isModalTarget(event.target)) return action.scope === 'modal' || action.defaultKeys.includes('escape')
  if (action.scope === 'list' && !isListTarget(event.target) && !isListTarget(document.activeElement)) return false
  if (action.scope === 'workspace' && !window.location.pathname.includes('/workspace') && !isListTarget(event.target)) return false
  if (!isTextTarget(event.target)) return true
  const binding = resolveHotkey(actionId, useHotkeyStore.getState().overrides)
  if (!binding) return false
  const lower = binding.toLowerCase()
  return lower.includes('+') || lower.includes('tab') || lower.includes('escape') || lower.includes('enter')
}

function scopeRank(actionId: string): number {
  const scope = HOTKEY_ACTIONS.find((item) => item.id === actionId)?.scope
  return scope === 'modal' ? 5 : scope === 'input' ? 4 : scope === 'list' ? 3 : scope === 'workspace' ? 2 : 1
}

export function HotkeyManager(): null {
  const navigate = useNavigate()
  const location = useLocation()
  const { switchProject } = useProjectNavigation()
  const projects = useProjectStore((state) => state.projects)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const previousProjectId = useProjectStore((state) => state.previousProjectId)
  const sessions = useSessionStore((state) => state.sessions)
  const unreadSessionIds = useSessionStore((state) => state.unreadSessionIds)
  const selectSession = useSessionStore((state) => state.selectSession)
  const { pinnedIds } = usePinnedProjects()
  const overrides = useHotkeyStore((state) => state.overrides)
  const validPinnedIds = pinnedIds.filter((id) => projects.some((project) => project.id === id))
  const chordTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const chordPending = useRef(false)

  const clearChord = useCallback(() => {
    chordPending.current = false
    if (chordTimer.current !== null) window.clearTimeout(chordTimer.current)
    chordTimer.current = null
    window.dispatchEvent(new CustomEvent<{ pending: boolean }>('ai-ide-hotkey-chord', { detail: { pending: false } }))
  }, [])

  const runNavigationAction = useCallback((actionId: string): boolean => {
    const projectId = currentProjectId ?? projects[0]?.id
    const projectPath: Record<string, string> = {
      'page.workspace': '/workspace', 'page.tasks': '/tasks', 'page.inspiration': '/inspiration',
      'page.knowledge': '/knowledge', 'page.schedule': '/schedule', 'page.events': '/events',
      'page.agent-memory': '/agent-memory', 'page.autonomy': '/autonomy', 'page.secretary': '/secretary',
    }
    if (actionId === 'page.dashboard') { navigate('/'); return true }
    if (actionId === 'page.spreadsheets') { navigate('/spreadsheets'); return true }
    if (actionId === 'page.reading') { navigate('/reading'); return true }
    if (actionId === 'page.updates') { navigate('/updates'); return true }
    if (actionId === 'page.agents') { navigate('/agents'); return true }
    if (actionId === 'page.pinned') { navigate('/pinned'); return true }
    if (actionId in projectPath && projectId) { navigate(`/p/${projectId}${projectPath[actionId]}`); return true }
    if (actionId.startsWith('project.tab-')) {
      const index = Number(actionId.slice(-1)) - 1
      const targetId = resolvePinnedProjectId(validPinnedIds, projects.map((project) => project.id), index)
      if (targetId) switchProject(targetId)
      return !!targetId
    }
    if (actionId === 'project.recent' && previousProjectId) { switchProject(previousProjectId); return true }
    if (actionId === 'project.next' || actionId === 'project.prev') {
      if (projects.length < 2) return false
      const index = Math.max(0, projects.findIndex((project) => project.id === currentProjectId))
      const offset = actionId === 'project.next' ? 1 : -1
      switchProject(projects[(index + offset + projects.length) % projects.length].id)
      return true
    }
    if (actionId === 'session.next-unread') {
      const routeToUnread = (allSessions: typeof sessions): void => {
        const unread = allSessions.filter((session) => (
          !!unreadSessionIds[session.id]
          || (!!session.last_message_at && (!session.last_read_at || Date.parse(session.last_message_at) > Date.parse(session.last_read_at)))
        ))
        if (unread.length === 0) return
        const currentIndex = unread.findIndex((session) => session.id === useSessionStore.getState().currentSessionId)
        const target = unread[(currentIndex + 1 + unread.length) % unread.length]
        if (location.pathname.includes('/workspace') && target.project_id === currentProjectId) selectSession(target.id)
        else if (target.project_id) navigate(`/p/${target.project_id}/workspace?sessionId=${encodeURIComponent(target.id)}`)
      }
      void queryClient.listSessions({}).then(routeToUnread).catch(() => routeToUnread(sessions))
      return true
    }
    if (actionId === 'app.hotkey-settings') { navigate('/settings#hotkeys'); return true }
    if (actionId === 'app.palette') {
      window.dispatchEvent(new CustomEvent('ai-ide-command-palette'))
      return true
    }
    return false
  }, [currentProjectId, location.pathname, navigate, previousProjectId, projects, selectSession, sessions, switchProject, unreadSessionIds, validPinnedIds])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) { clearChord(); return }
      if (isTextTarget(event.target) && event.key.toLowerCase() === 'g') { clearChord(); return }
      const key = bindingFromEvent(event)
      if (!key) return
      if (chordPending.current) {
        const chord = `g ${key}`
        if (key === 'g') { clearChord(); return }
        const action = HOTKEY_ACTIONS
          .filter((item) => resolveHotkey(item.id, overrides) === chord)
          .sort((left, right) => scopeRank(right.id) - scopeRank(left.id))
          .find((item) => scopeAllows(item.id, event))
        clearChord()
        if (!action) return
        event.preventDefault()
        if (!runNavigationAction(action.id)) dispatchHotkeyAction(action.id)
        return
      }
      if (key === 'g' && !isTextTarget(event.target) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        chordPending.current = true
        chordTimer.current = window.setTimeout(clearChord, 600)
        event.preventDefault()
        window.dispatchEvent(new CustomEvent<{ pending: boolean }>('ai-ide-hotkey-chord', { detail: { pending: true } }))
        return
      }
      const action = HOTKEY_ACTIONS
        .filter((item) => resolveHotkey(item.id, overrides) === key)
        .sort((left, right) => scopeRank(right.id) - scopeRank(left.id))
        .find((item) => scopeAllows(item.id, event))
      if (!action) return
      event.preventDefault()
      if (!runNavigationAction(action.id)) dispatchHotkeyAction(action.id)
    }
    window.addEventListener('keydown', onKeyDown)
    const onFocusIn = (event: FocusEvent): void => {
      if (isTextTarget(event.target)) clearChord()
    }
    window.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('focusin', onFocusIn)
    }
  }, [clearChord, location.pathname, overrides, runNavigationAction])

  useEffect(() => subscribeHotkeyActions((actionId) => {
    runNavigationAction(actionId)
  }), [runNavigationAction])

  useEffect(() => () => clearChord(), [clearChord])
  return null
}
