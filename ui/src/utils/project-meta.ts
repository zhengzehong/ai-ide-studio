import { create } from 'zustand'

const PINNED_KEY = 'ai-ide-pinned-projects'
const MAX_PINS = 5

export const PROJECT_COLORS = [
  '#2563eb', // blue
  '#059669', // green
  '#ea580c', // orange
  '#dc2626', // red
  '#7c3aed', // purple
  '#db2777', // pink
  '#0891b2', // cyan
  '#65a30d', // lime
]

export const PROJECT_ICONS = [
  '📦', '🚀', '🎯', '💻', '🔧', '📚', '🎨', '⚡',
  '🌟', '🔥', '💡', '🛠️', '🏰', '🏆', '🌱', '🧪',
  '🏗️', '🚂', '🦊', '🐙',
]

export function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function autoColor(name: string): string {
  if (!name) return PROJECT_COLORS[0]
  return PROJECT_COLORS[hashString(name) % PROJECT_COLORS.length]
}

export function autoIcon(name: string): string {
  if (!name) return PROJECT_ICONS[0]
  return PROJECT_ICONS[hashString(name) % PROJECT_ICONS.length]
}

export function resolveProjectColor(project: { color?: string | null; name?: string }): string {
  return project.color ?? autoColor(project.name ?? '')
}

export function resolveProjectIcon(project: { icon?: string | null; name?: string }): string {
  return project.icon ?? autoIcon(project.name ?? '')
}

function loadFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_PINS)
  } catch {
    return []
  }
}

function saveToStorage(ids: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids.slice(0, MAX_PINS)))
  } catch {
    // ignore
  }
}

interface PinnedProjectsState {
  pinnedIds: string[]
  togglePin: (id: string) => void
  reorder: (from: number, to: number) => void
  isPinned: (id: string) => boolean
}

export const usePinnedProjects = create<PinnedProjectsState>((set, get) => ({
  pinnedIds: loadFromStorage(),
  togglePin: (id) => {
    const current = get().pinnedIds
    let next: string[]
    if (current.includes(id)) {
      next = current.filter((x) => x !== id)
    } else if (current.length >= MAX_PINS) {
      // drop oldest, append new
      next = [...current.slice(current.length - MAX_PINS + 1), id]
    } else {
      next = [...current, id]
    }
    saveToStorage(next)
    set({ pinnedIds: next })
  },
  reorder: (from, to) => {
    const current = get().pinnedIds
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return
    const next = [...current]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    saveToStorage(next)
    set({ pinnedIds: next })
  },
  isPinned: (id) => get().pinnedIds.includes(id),
}))

export const MAX_PINNED = MAX_PINS
