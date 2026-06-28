import type { KnowledgeLinkData } from '../../stores/knowledge-base.store'

export function renderWikiMarkdown(body: string, links: KnowledgeLinkData[]): string {
  const linkMap = new Map(links.map((link) => [link.text, link]))
  return body.replace(/\[\[([^\]]+)\]\]/g, (_match, raw: string) => {
    const text = raw.trim()
    const link = linkMap.get(text)
    const status = link?.status ?? 'missing'
    const pageId = link?.pageId ?? ''
    const kbId = link?.kbId ?? ''
    return `[${text}](kb://${encodeURIComponent(status)}/${encodeURIComponent(kbId)}/${encodeURIComponent(pageId)}/${encodeURIComponent(text)})`
  })
}

export function parseWikiHref(href: string | undefined): { status: string; kbId: string; pageId: string; text: string } | null {
  if (!href?.startsWith('kb://')) return null
  const parts = href.replace(/^kb:\/\//, '').split('/').map((part) => decodeURIComponent(part))
  return {
    status: parts[0] ?? 'missing',
    kbId: parts[1] ?? '',
    pageId: parts[2] ?? '',
    text: parts[3] ?? '',
  }
}

export function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
