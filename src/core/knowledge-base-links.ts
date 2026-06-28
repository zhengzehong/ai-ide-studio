import { createChildLogger } from './logger.js'
import { computeFingerprint, normalizeTitle, parseFingerprint, parseJsonArray, parseWikiLinks } from './knowledge-base-utils.js'
import { knowledgeBaseStore, type KnowledgeBaseRow } from '../store/knowledge-bases.js'
import { knowledgePageStore, type KnowledgePageRow } from '../store/knowledge-pages.js'
import { bodyWithGeneratedIndex } from './knowledge-base-index.js'
import type { KnowledgeBacklink, KnowledgeLink } from './knowledge-base-types.js'

const log = createChildLogger('knowledge-base')

export function resolveReadLinks(
  projectId: string,
  visibleKnowledgeBases: KnowledgeBaseRow[],
  page: KnowledgePageRow,
): { outLinks: KnowledgeLink[]; backlinks: KnowledgeBacklink[] } {
  void projectId
  return {
    outLinks: uniqueLinks(parseWikiLinks(page.body).map((link) => resolveWikiLink(visibleKnowledgeBases, page.kb_id, link))),
    backlinks: listBacklinks(visibleKnowledgeBases, page),
  }
}

export function maybeMarkStale(page: KnowledgePageRow, baseDir?: string): KnowledgePageRow {
  const files = parseJsonArray(page.src_files_json)
  if (files.length === 0 || !page.src_fingerprint_json) return page
  try {
    const current = computeFingerprint(files, baseDir)
    const previous = parseFingerprint(page.src_fingerprint_json)
    if (!previous || JSON.stringify(current) === JSON.stringify(previous)) return page
    return knowledgePageStore.update(page.id, { stale: true }) ?? page
  } catch (err) {
    log.warn({ err, pageId: page.id }, 'knowledge page stale check failed')
    return page
  }
}

function resolveWikiLink(visible: KnowledgeBaseRow[], currentKbId: string, text: string): KnowledgeLink {
  const scoped = splitScopedLink(text)
  if (scoped.kbName) {
    const kbMatches = visible.filter((kb) => normalizeTitle(kb.name) === normalizeTitle(scoped.kbName!))
    if (kbMatches.length === 0) return { text, kbId: null, pageId: null, title: scoped.title, status: 'invisible' }
    const pages = kbMatches
      .map((kb) => ({ kb, page: knowledgePageStore.getByTitle(kb.id, normalizeTitle(scoped.title)) }))
      .filter((item): item is { kb: KnowledgeBaseRow; page: KnowledgePageRow } => Boolean(item.page))
    if (pages.length > 1) return { text, kbId: null, pageId: null, title: scoped.title, status: 'ambiguous' }
    if (pages.length === 0) return { text, kbId: kbMatches[0].id, pageId: null, title: scoped.title, status: 'missing' }
    return { text, kbId: pages[0].kb.id, pageId: pages[0].page.id, title: pages[0].page.title, status: 'resolved' }
  }

  const current = knowledgePageStore.getByTitle(currentKbId, normalizeTitle(scoped.title))
  if (current) return { text, kbId: current.kb_id, pageId: current.id, title: current.title, status: 'resolved' }
  const pages = visible
    .map((kb) => knowledgePageStore.getByTitle(kb.id, normalizeTitle(scoped.title)))
    .filter((page): page is KnowledgePageRow => Boolean(page))
  if (pages.length > 1) return { text, kbId: null, pageId: null, title: scoped.title, status: 'ambiguous' }
  if (pages.length === 0) return { text, kbId: currentKbId, pageId: null, title: scoped.title, status: 'missing' }
  return { text, kbId: pages[0].kb_id, pageId: pages[0].id, title: pages[0].title, status: 'resolved' }
}

function splitScopedLink(text: string): { kbName?: string; title: string } {
  const index = text.indexOf('/')
  if (index <= 0) return { title: text.trim() }
  return { kbName: text.slice(0, index).trim(), title: text.slice(index + 1).trim() }
}

function listBacklinks(visible: KnowledgeBaseRow[], target: KnowledgePageRow): KnowledgeBacklink[] {
  const pages = knowledgePageStore.listByKbs(visible.map((kb) => kb.id))
  const kbMap = new Map(visible.map((kb) => [kb.id, kb]))
  const targetKb = knowledgeBaseStore.get(target.kb_id)
  const targetTexts = new Set([
    normalizeTitle(target.title),
    targetKb ? normalizeTitle(`${targetKb.name}/${target.title}`) : '',
  ].filter(Boolean))
  return pages
    .filter((page) => page.id !== target.id)
    .filter((page) => {
      const kb = kbMap.get(page.kb_id)
      const body = kb ? bodyWithGeneratedIndex(kb, page, pages) : page.body
      return parseWikiLinks(body).some((link) => targetTexts.has(normalizeTitle(link)))
    })
    .map((page) => ({ kbId: page.kb_id, pageId: page.id, title: page.title }))
}

function uniqueLinks(links: KnowledgeLink[]): KnowledgeLink[] {
  const seen = new Set<string>()
  return links.filter((link) => {
    const key = `${link.status}:${link.kbId ?? ''}:${link.pageId ?? ''}:${normalizeTitle(link.text)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
