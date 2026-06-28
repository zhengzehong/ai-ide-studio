// Lightweight toast for transient user feedback (e.g. RPC failure rollback notices).
// Mounts a single fixed-position element on first call. No external dependency.

interface ToastEntry {
  id: number
  message: string
  expiresAt: number
}

const DISPLAY_MS = 2200
let nextId = 1
const listeners = new Set<(entries: ToastEntry[]) => void>()
let entries: ToastEntry[] = []

function emit(): void {
  for (const fn of listeners) fn(entries)
}

function scheduleExpiry(entry: ToastEntry): void {
  const delay = entry.expiresAt - Date.now()
  setTimeout(() => {
    entries = entries.filter((item) => item.id !== entry.id)
    emit()
  }, Math.max(0, delay))
}

export function showToast(message: string): void {
  if (typeof document === 'undefined') return
  ensureMount()
  const entry: ToastEntry = {
    id: nextId++,
    message,
    expiresAt: Date.now() + DISPLAY_MS,
  }
  entries = [...entries, entry]
  emit()
  scheduleExpiry(entry)
}

export function subscribeToast(fn: (entries: ToastEntry[]) => void): () => void {
  listeners.add(fn)
  fn(entries)
  return () => {
    listeners.delete(fn)
  }
}

export function dismissToast(id: number): void {
  entries = entries.filter((item) => item.id !== id)
  emit()
}

// Internal — render host. Mounted lazily so SSR / non-DOM environments don't error.
let mounted = false

function ensureMount(): void {
  if (mounted || typeof document === 'undefined') return
  mounted = true
  const host = document.createElement('div')
  host.id = 'mobile-toast-host'
  host.style.position = 'fixed'
  host.style.left = '0'
  host.style.right = '0'
  host.style.bottom = 'calc(20px + var(--safe-bottom, 0px))'
  host.style.display = 'flex'
  host.style.flexDirection = 'column'
  host.style.alignItems = 'center'
  host.style.gap = '8px'
  host.style.pointerEvents = 'none'
  host.style.zIndex = '2000'
  document.body.appendChild(host)

  const render = (current: ToastEntry[]) => {
    host.innerHTML = ''
    for (const entry of current) {
      const el = document.createElement('div')
      el.textContent = entry.message
      el.style.pointerEvents = 'auto'
      el.style.background = 'rgba(30, 30, 36, .92)'
      el.style.color = '#fff'
      el.style.fontSize = '13px'
      el.style.padding = '8px 14px'
      el.style.borderRadius = '8px'
      el.style.boxShadow = '0 4px 12px rgba(0,0,0,.2)'
      el.style.maxWidth = '80vw'
      el.style.textAlign = 'center'
      host.appendChild(el)
    }
  }
  subscribeToast(render)
}
