export function readPreviewCookie(rawCookie: string | undefined): string | undefined {
  const name = 'ai-ide-preview-token='
  const value = rawCookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(name))?.slice(name.length)
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

export function previewAuthCookie(token: string, previewId: string): string {
  return `ai-ide-preview-token=${encodeURIComponent(token)}; Path=/preview/${previewId}/; HttpOnly; SameSite=Lax`
}
