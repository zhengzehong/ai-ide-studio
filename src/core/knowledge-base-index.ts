import type { KnowledgeBaseRow } from '../store/knowledge-bases.js'
import type { KnowledgePageRow } from '../store/knowledge-pages.js'

const INDEX_START = '<!-- AI_IDE_KB_INDEX_START -->'
const INDEX_END = '<!-- AI_IDE_KB_INDEX_END -->'

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
  const lines = [INDEX_START, '## 页面索引', '']
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
  lines.push(INDEX_END)
  return `${body}\n\n${lines.join('\n')}`.trim()
}

function stripGeneratedIndex(body: string): string {
  const start = body.indexOf(INDEX_START)
  const end = body.indexOf(INDEX_END)
  if (start === -1 || end === -1 || end < start) return body
  return `${body.slice(0, start)}${body.slice(end + INDEX_END.length)}`
}
