export function readReadingCookie(rawCookie: string | undefined): string | undefined {
  const name = 'ai-ide-reading-token='
  const value = rawCookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(name))?.slice(name.length)
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

export function readingAuthCookie(token: string, readingId: string): string {
  return `ai-ide-reading-token=${encodeURIComponent(token)}; Path=/reading/${readingId}/; HttpOnly; SameSite=Lax`
}
