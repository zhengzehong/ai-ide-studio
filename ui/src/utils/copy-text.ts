export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand fallback
  }
  return copyWithExecCommand(text)
}

function copyWithExecCommand(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-9999px'
  ta.style.left = '-9999px'
  let appended = false
  try {
    document.body.appendChild(ta)
    appended = true
    ta.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    if (appended) { try { ta.remove() } catch { /* ignore */ } }
  }
}
