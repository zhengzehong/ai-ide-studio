// Haptic helper for long-press feedback.
// Uses navigator.vibrate (works in Android WebView and supported browsers).
// Returns a promise for ergonomic call sites; failures are swallowed.

export function triggerHaptic(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(10)
  } catch {
    // ignore — best-effort feedback
  }
}
