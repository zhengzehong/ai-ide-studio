export type HotkeyKey = string

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  '+': 'plus',
  '}': ']',
  '{': '[',
}

function normalizeBaseKey(key: string): string {
  const normalized = key.trim().toLowerCase()
  return KEY_ALIASES[normalized] ?? normalized
}

export function eventKey(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  const key = normalizeBaseKey(event.key)
  if (!['control', 'meta', 'alt', 'shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

export function normalizeBinding(binding: string): string {
  const parts = binding.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return parts.map((part) => {
    const modifiers = part.split('+').filter(Boolean)
    if (modifiers.length === 0) return ''
    const key = normalizeBaseKey(modifiers.pop() ?? '')
    const ordered = ['mod', 'ctrl', 'alt', 'shift'].filter((modifier) => modifiers.includes(modifier))
    return [...ordered, key].join('+')
  }).filter(Boolean).join(' ')
}

export function isValidBinding(binding: string): boolean {
  const normalized = normalizeBinding(binding)
  if (!normalized || normalized.split(' ').length > 2) return false
  return normalized.split(' ').every((part) => {
    const key = part.split('+').at(-1) ?? ''
    return key.length > 0 && key !== 'control' && key !== 'meta' && key !== 'alt' && key !== 'shift'
  })
}

export function formatBinding(binding: string | null | undefined): string {
  if (!binding) return '已禁用'
  return normalizeBinding(binding).split(' ').map((part) => part.split('+').map((key) => {
    if (key === 'mod') {
      const platform = typeof navigator === 'undefined' ? '' : navigator.platform.toLowerCase()
      return platform.includes('mac') ? '⌘' : 'Ctrl'
    }
    if (key === 'alt') return 'Alt'
    if (key === 'shift') return 'Shift'
    if (key === 'arrowleft') return '←'
    if (key === 'arrowright') return '→'
    if (key === 'arrowup') return '↑'
    if (key === 'arrowdown') return '↓'
    return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)
  }).join('+')).join(' ')
}

export function bindingFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing) return null
  const value = eventKey(event)
  return value && value !== 'mod' && value !== 'alt' && value !== 'shift' ? value : null
}
