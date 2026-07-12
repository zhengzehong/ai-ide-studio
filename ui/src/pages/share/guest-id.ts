const GUEST_ID_KEY = 'ai-ide-share-guest-id'
const GUEST_NAME_KEY = 'ai-ide-share-guest-name'

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getOrCreateGuestId(): string {
  if (typeof localStorage === 'undefined') return `guest_${randomUuid()}`
  const existing = localStorage.getItem(GUEST_ID_KEY)
  if (existing) return existing
  const id = `guest_${randomUuid()}`
  localStorage.setItem(GUEST_ID_KEY, id)
  return id
}

export function getGuestId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(GUEST_ID_KEY)
}

export function getGuestName(): string {
  if (typeof localStorage === 'undefined') return '访客'
  return localStorage.getItem(GUEST_NAME_KEY) ?? '访客'
}

export function setGuestName(name: string): void {
  if (typeof localStorage === 'undefined') return
  const trimmed = name.trim()
  if (trimmed) localStorage.setItem(GUEST_NAME_KEY, trimmed)
}
