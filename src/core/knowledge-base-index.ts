import { randomUUID } from 'crypto'
import type { KnowledgeBaseRow } from '../store/knowledge-bases.js'
import type { KnowledgePageRow } from '../store/knowledge-pages.js'

const LEGACY_INDEX_START = '<!-- AI_IDE_KB_INDEX_START -->'
const LEGACY_INDEX_END = '<!-- AI_IDE_KB_INDEX_END -->'

export function withGeneratedIndexBody(
  kb: KnowledgeBaseRow,
  page: KnowledgePageRow,
  pages: KnowledgePageRow[],
): KnowledgePageRow {
  if (!page.is_index) return page
  return { ...page, body: buildIndexBody(kb, page, pages) }
}

export function bodyWithGeneratedIndex(
  kb: KnowledgeBaseRow,
  page: KnowledgePageRow,
  pages: KnowledgePageRow[],
): string {
  return page.is_index ? buildIndexBody(kb, page, pages) : page.body
}

function buildIndexBody(kb: KnowledgeBaseRow, indexPage: KnowledgePageRow, pages: KnowledgePageRow[]): string {
  const body = stripGeneratedIndex(indexPage.body).trimEnd()
  const indexId = randomUUID()
  const startMarker = `<!-- AI_IDE_KB_INDEX_START:${indexId} -->`
  const endMarker = `<!-- AI_IDE_KB_INDEX_END:${indexId} -->`
  const lines = [startMarker, '## 页面索引', '']
  const visiblePages = pages.filter((page) => page.kb_id === kb.id && page.id !== indexPage.id)
  if (visiblePages.length === 0) {
    lines.push('暂无页面。')
  } else {
    const sections = new Map<string, KnowledgePageRow[]>()
    for (const page of visiblePages) {
      const section = page.section?.trim() || '未分组'
      sections.set(section, [...(sections.get(section) ?? []), page])
    }
    for (const [section, sectionPages] of sections) {
      lines.push(`### ${section}`)
      for (const page of sectionPages) {
        lines.push(`- [[${page.title}]]${page.summary ? ` - ${page.summary}` : ''}`)
      }
      lines.push('')
    }
  }
  lines.push(endMarker)
  return `${body}\n\n${lines.join('\n')}`.trim()
}

export function stripGeneratedIndex(body: string): string {
  let result = body
  const pairedRegex =
    /<!--\s*AI_IDE_KB_INDEX_START:([0-9a-fA-F-]{36})\s*-->[\s\S]*?<!--\s*AI_IDE_KB_INDEX_END:\1\s*-->/g
  result = result.replace(pairedRegex, '')
  const legacyStart = result.indexOf(LEGACY_INDEX_START)
  const legacyEnd = result.indexOf(LEGACY_INDEX_END)
  if (legacyStart !== -1 && legacyEnd !== -1 && legacyEnd > legacyStart) {
    result = `${result.slice(0, legacyStart)}${result.slice(legacyEnd + LEGACY_INDEX_END.length)}`
  }
  return result
}
