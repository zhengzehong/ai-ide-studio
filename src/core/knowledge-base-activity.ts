import { knowledgeActivityStore, type KnowledgeActivityRow, type KnowledgeActorType } from '../store/knowledge-activities.js'
import { knowledgePageStore, type KnowledgePageRow } from '../store/knowledge-pages.js'
import { parseFingerprint, parseJsonArray } from './knowledge-base-utils.js'

export function recordKnowledgeActivity(input: {
  kbId: string
  pageId?: string | null
  act: KnowledgeActivityRow['act']
  actor: string
  actorType: KnowledgeActorType
  tool: string
  note?: string | null
  prevBody?: string | null
  prevSnapshot?: Record<string, unknown> | null
  nextSnapshot?: Record<string, unknown> | null
}): KnowledgeActivityRow {
  return knowledgeActivityStore.create({
    kbId: input.kbId,
    pageId: input.pageId,
    act: input.act,
    actor: input.actor,
    actorType: input.actorType,
    tool: input.tool,
    note: input.note,
    prevBody: input.prevBody,
    prevSnapshot: input.prevSnapshot,
    nextSnapshot: input.nextSnapshot,
  })
}

export function snapshotPage(page: KnowledgePageRow): Record<string, unknown> {
  return {
    id: page.id,
    kb_id: page.kb_id,
    title: page.title,
    title_norm: page.title_norm,
    section: page.section,
    summary: page.summary,
    body: page.body,
    author: page.author,
    by: page.by,
    tags_json: page.tags_json,
    is_index: page.is_index,
    src_files_json: page.src_files_json,
    src_fingerprint_json: page.src_fingerprint_json,
    stale: page.stale,
    last_human_edit_at: page.last_human_edit_at,
  }
}

export function restorePageSnapshot(pageId: string, snapshot: Record<string, unknown>): KnowledgePageRow | undefined {
  return knowledgePageStore.update(pageId, {
    title: stringValue(snapshot.title),
    titleNorm: stringValue(snapshot.title_norm),
    section: nullableStringValue(snapshot.section),
    summary: nullableStringValue(snapshot.summary),
    body: stringValue(snapshot.body),
    author: stringValue(snapshot.author),
    by: nullableStringValue(snapshot.by),
    tags: parseJsonArray(snapshot.tags_json),
    isIndex: snapshot.is_index === 1,
    srcFiles: parseJsonArray(snapshot.src_files_json),
    srcFingerprint: parseFingerprint(snapshot.src_fingerprint_json),
    stale: snapshot.stale === 1,
    lastHumanEditAt: nullableStringValue(snapshot.last_human_edit_at),
  })
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
