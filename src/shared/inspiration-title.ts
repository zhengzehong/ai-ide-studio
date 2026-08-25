export const INSPIRATION_AUTO_TITLE_MAX_LENGTH = 60

export type InspirationTitleMode = 'auto' | 'manual'

const LEGACY_TITLE_PATTERN = /^\d{1,2}月\d{1,2}日 灵感$/u

export function deriveInspirationTitle(sourceMarkdown: string): string {
  const normalized = sourceMarkdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/```[^\n]*\n?/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const characters = Array.from(normalized)
  if (characters.length <= INSPIRATION_AUTO_TITLE_MAX_LENGTH) return normalized
  return `${characters.slice(0, INSPIRATION_AUTO_TITLE_MAX_LENGTH - 1).join('')}…`
}

export function isLegacyInspirationTitle(title: string): boolean {
  return LEGACY_TITLE_PATTERN.test(title.trim())
}

export function resolveInspirationTitle(input: {
  title?: string
  titleMode?: InspirationTitleMode
  sourceMarkdown: string
  current?: { title: string; titleMode: InspirationTitleMode }
}): { title: string; titleMode: InspirationTitleMode } {
  const requestedTitle = input.title?.trim() ?? ''
  const mode = inferTitleMode(requestedTitle, input.titleMode, input.current)
  if (mode === 'manual') return { title: requestedTitle, titleMode: mode }
  const title = deriveInspirationTitle(input.sourceMarkdown)
  if (!title) throw new Error('灵感内容无法生成标题')
  return { title, titleMode: mode }
}

function inferTitleMode(
  requestedTitle: string,
  requestedMode: InspirationTitleMode | undefined,
  current: { title: string; titleMode: InspirationTitleMode } | undefined,
): InspirationTitleMode {
  if (requestedMode === 'manual' && requestedTitle) return 'manual'
  if (requestedMode === 'auto' || !requestedTitle || isLegacyInspirationTitle(requestedTitle)) return 'auto'
  if (current?.titleMode === 'auto' && requestedTitle === current.title) return 'auto'
  return 'manual'
}
