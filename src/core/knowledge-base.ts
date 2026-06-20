import { events } from './events.js'
import {
  clampLimit,
  computeFingerprint,
  normalizeTitle,
  parseJsonArray,
  parseSnapshot,
} from './knowledge-base-utils.js'
import { maybeMarkStale, resolveReadLinks } from './knowledge-base-links.js'
import { recordKnowledgeActivity, restorePageSnapshot, snapshotPage } from './knowledge-base-activity.js'
import { withGeneratedIndexBody } from './knowledge-base-index.js'
import { projectStore } from '../store/projects.js'
import { knowledgeActivityStore, type KnowledgeActivityRow, type KnowledgeActorType } from '../store/knowledge-activities.js'
import { knowledgeBaseStore, type KnowledgeBaseRow } from '../store/knowledge-bases.js'
import { knowledgeMountStore, type KnowledgeMountRow } from '../store/knowledge-mounts.js'
import { knowledgePageStore, type KnowledgePageRow } from '../store/knowledge-pages.js'
import type {
  CreateKnowledgeBaseServiceInput,
  CreateKnowledgePageServiceInput,
  KnowledgeReadResult,
  RefreshKnowledgePageInput,
  UpdateKnowledgePageServiceInput,
} from './knowledge-base-types.js'

export const knowledgeBaseService = {
  ensureProjectKnowledgeBase(projectId: string): KnowledgeBaseRow {
    const project = projectStore.get(projectId)
    if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectId}`)
    const existing = knowledgeBaseStore.getProject(projectId)
    if (existing) return ensureIndexPage(existing, 'system', 'system')

    const kb = knowledgeBaseStore.create({
      name: project.name,
      kind: 'project',
      src: 'manual',
      projectId,
      icon: 'KB',
      description: '项目知识库',
    })
    const page = createIndexPage(kb, 'system', 'system')
    const updated = knowledgeBaseStore.setIndexPage(kb.id, page.id) ?? kb
    recordKnowledgeActivity({
      kbId: updated.id,
      pageId: page.id,
      act: 'create_kb',
      actor: 'system',
      actorType: 'system',
      tool: 'system',
      note: '项目知识库自动创建',
      nextSnapshot: snapshotPage(page),
    })
    emitUpdate({ projectId, kbId: updated.id, event: 'kb.created' })
    return updated
  },

  createKnowledgeBase(input: CreateKnowledgeBaseServiceInput): KnowledgeBaseRow {
    if (!input.name.trim()) throw new Error('NAME_REQUIRED')
    if (input.kind === 'project') {
      if (!input.projectId) throw new Error('PROJECT_REQUIRED_FOR_PROJECT_KB')
      if (knowledgeBaseStore.getProject(input.projectId)) throw new Error('PROJECT_KB_ALREADY_EXISTS')
    }
    const kb = knowledgeBaseStore.create({
      name: input.name.trim(),
      kind: input.kind,
      src: input.src,
      icon: input.icon,
      description: input.description,
      projectId: input.projectId,
    })
    const page = createIndexPage(kb, input.actor, input.actorType ?? 'ai')
    const updated = knowledgeBaseStore.setIndexPage(kb.id, page.id) ?? kb
    recordKnowledgeActivity({
      kbId: updated.id,
      pageId: page.id,
      act: 'create_kb',
      actor: input.actor,
      actorType: input.actorType ?? 'ai',
      tool: input.tool,
      note: input.note,
      nextSnapshot: snapshotPage(page),
    })
    emitUpdate({ projectId: input.projectId ?? null, kbId: updated.id, event: 'kb.created' })
    return updated
  },

  listVisibleKnowledgeBases(projectId: string): KnowledgeBaseRow[] {
    knowledgeBaseService.ensureProjectKnowledgeBase(projectId)
    return knowledgeBaseStore.listVisible(projectId)
  },

  listPages(projectId: string, kbId: string): KnowledgePageRow[] {
    assertKbVisible(kbId, projectId)
    const projectWorkDir = getProjectWorkDir(projectId)
    const pages = knowledgePageStore.listByKb(kbId)
    return pages.map((page) => maybeMarkStale(page, projectWorkDir))
  },

  readIndex(projectId: string, kbId: string): KnowledgeReadResult {
    const kb = assertKbVisible(kbId, projectId)
    if (!kb.index_page_id) throw new Error('INDEX_NOT_FOUND')
    return knowledgeBaseService.readPage({ projectId, pageId: kb.index_page_id })
  },

  readPage(input: { projectId: string; pageId?: string; kbId?: string; title?: string }): KnowledgeReadResult {
    let page: KnowledgePageRow | undefined
    if (input.pageId) page = knowledgePageStore.get(input.pageId)
    else if (input.kbId && input.title) {
      assertKbVisible(input.kbId, input.projectId)
      page = knowledgePageStore.getByTitle(input.kbId, normalizeTitle(input.title))
    } else {
      throw new Error('PAGE_ID_OR_TITLE_REQUIRED')
    }
    if (!page) throw new Error('PAGE_NOT_FOUND')
    const kb = assertKbVisible(page.kb_id, input.projectId)
    const freshPage = withGeneratedIndexBody(
      kb,
      maybeMarkStale(page, getProjectWorkDir(input.projectId)),
      knowledgePageStore.listByKb(kb.id),
    )
    const visible = knowledgeBaseService.listVisibleKnowledgeBases(input.projectId)
    const links = resolveReadLinks(input.projectId, visible, freshPage)
    return {
      kb,
      page: freshPage,
      ...links,
    }
  },

  search(input: { projectId: string; query: string; kbIds?: string[]; limit?: number }): KnowledgePageRow[] {
    const query = input.query.trim()
    if (!query) throw new Error('QUERY_REQUIRED')
    const visibleIds = new Set(knowledgeBaseService.listVisibleKnowledgeBases(input.projectId).map((kb) => kb.id))
    const kbIds = input.kbIds?.length ? input.kbIds : [...visibleIds]
    for (const kbId of kbIds) {
      if (!visibleIds.has(kbId)) throw new Error(`KB_NOT_VISIBLE: ${kbId}`)
    }
    return knowledgePageStore.search(kbIds, query, clampLimit(input.limit))
  },

  createPage(input: CreateKnowledgePageServiceInput): { page: KnowledgePageRow; activity: KnowledgeActivityRow; warnings: string[] } {
    const kb = assertKbVisible(input.kbId, input.projectId)
    if (!input.title.trim()) throw new Error('TITLE_REQUIRED')
    if (!input.body.trim()) throw new Error('BODY_REQUIRED')
    const titleNorm = normalizeTitle(input.title)
    if (knowledgePageStore.getByTitle(input.kbId, titleNorm)) throw new Error('TITLE_EXISTS')
    const srcFiles = kb.src === 'code' ? input.srcFiles ?? [] : []
    const page = knowledgePageStore.create({
      kbId: input.kbId,
      title: input.title.trim(),
      titleNorm,
      section: input.section,
      summary: input.summary,
      body: input.body,
      author: input.actorType === 'human' ? 'human' : 'ai',
      by: input.actor,
      tags: input.tags,
      isIndex: input.isIndex,
      srcFiles,
      srcFingerprint: srcFiles.length ? computeFingerprint(srcFiles, getProjectWorkDir(input.projectId)) : null,
      lastHumanEditAt: input.actorType === 'human' ? new Date().toISOString() : null,
    })
    const activity = recordKnowledgeActivity({
      kbId: page.kb_id,
      pageId: page.id,
      act: 'create',
      actor: input.actor,
      actorType: input.actorType ?? 'ai',
      tool: input.tool,
      note: input.note,
      prevBody: null,
      nextSnapshot: snapshotPage(page),
    })
    const updated = knowledgePageStore.update(page.id, { lastActivityId: activity.id }) ?? page
    knowledgeBaseStore.touch(kb.id)
    emitUpdate({ projectId: input.projectId, kbId: input.kbId, pageId: page.id, event: 'page.created' })
    return { page: updated, activity, warnings: resolveReadLinks(input.projectId, knowledgeBaseService.listVisibleKnowledgeBases(input.projectId), page).backlinks.length ? [] : ['ORPHAN_PAGE'] }
  },

  updatePage(input: UpdateKnowledgePageServiceInput): { page: KnowledgePageRow; activity: KnowledgeActivityRow } {
    const existing = assertPageVisible(input.projectId, input.pageId)
    if (!input.body.trim()) throw new Error('BODY_REQUIRED')
    const title = input.title?.trim() ?? existing.title
    const titleNorm = normalizeTitle(title)
    const sameTitle = titleNorm === existing.title_norm
    if (!sameTitle && knowledgePageStore.getByTitle(existing.kb_id, titleNorm)) throw new Error('TITLE_EXISTS')
    const actorType = input.actorType ?? 'ai'
    const updated = knowledgePageStore.update(existing.id, {
      title,
      titleNorm,
      section: input.section !== undefined ? input.section : existing.section,
      summary: input.summary !== undefined ? input.summary : existing.summary,
      body: input.body,
      author: actorType === 'human' ? 'human' : 'ai',
      by: input.actor,
      tags: input.tags,
      lastHumanEditAt: actorType === 'human' ? new Date().toISOString() : existing.last_human_edit_at,
    })
    if (!updated) throw new Error('PAGE_NOT_FOUND')
    const activity = recordKnowledgeActivity({
      kbId: updated.kb_id,
      pageId: updated.id,
      act: 'edit',
      actor: input.actor,
      actorType,
      tool: input.tool,
      note: input.note,
      prevBody: existing.body,
      prevSnapshot: snapshotPage(existing),
      nextSnapshot: snapshotPage(updated),
    })
    const page = knowledgePageStore.update(updated.id, { lastActivityId: activity.id }) ?? updated
    knowledgeBaseStore.touch(page.kb_id)
    emitUpdate({ projectId: input.projectId, kbId: page.kb_id, pageId: page.id, event: 'page.updated' })
    return { page, activity }
  },

  refreshFromCode(input: RefreshKnowledgePageInput): { page: KnowledgePageRow; activity: KnowledgeActivityRow } {
    const existing = assertPageVisible(input.projectId, input.pageId)
    const kb = assertKbVisible(existing.kb_id, input.projectId)
    if (kb.src !== 'code') throw new Error('KB_NOT_CODE_SOURCE')
    if (existing.last_human_edit_at && input.confirmOverwriteHumanEdit !== true) {
      throw new Error('HUMAN_EDIT_CONFIRM_REQUIRED')
    }
    const srcFiles = input.srcFiles ?? parseJsonArray(existing.src_files_json)
    const fingerprint = srcFiles.length ? computeFingerprint(srcFiles, getProjectWorkDir(input.projectId)) : null
    const updated = knowledgePageStore.update(existing.id, {
      body: input.body,
      author: input.actorType === 'human' ? 'human' : 'ai',
      by: input.actor,
      srcFiles,
      srcFingerprint: fingerprint,
      stale: false,
      lastHumanEditAt: input.actorType === 'human' ? new Date().toISOString() : null,
    })
    if (!updated) throw new Error('PAGE_NOT_FOUND')
    const activity = recordKnowledgeActivity({
      kbId: updated.kb_id,
      pageId: updated.id,
      act: 'refresh',
      actor: input.actor,
      actorType: input.actorType ?? 'ai',
      tool: input.tool,
      note: input.note,
      prevBody: existing.body,
      prevSnapshot: snapshotPage(existing),
      nextSnapshot: snapshotPage(updated),
    })
    const page = knowledgePageStore.update(updated.id, { lastActivityId: activity.id }) ?? updated
    emitUpdate({ projectId: input.projectId, kbId: page.kb_id, pageId: page.id, event: 'page.refreshed' })
    return { page, activity }
  },

  mountKnowledgeBase(input: { projectId: string; kbId: string; actor: string; tool: string; note?: string | null }): KnowledgeMountRow {
    const kb = knowledgeBaseStore.get(input.kbId)
    if (!kb) throw new Error('KB_NOT_FOUND')
    if (kb.kind !== 'shared') throw new Error('ONLY_SHARED_KB_CAN_MOUNT')
    const mount = knowledgeMountStore.create({ projectId: input.projectId, kbId: input.kbId, createdBy: input.actor })
    recordKnowledgeActivity({
      kbId: input.kbId,
      act: 'mount',
      actor: input.actor,
      actorType: input.actor === 'human' ? 'human' : 'ai',
      tool: input.tool,
      note: input.note,
    })
    emitUpdate({ projectId: input.projectId, kbId: input.kbId, event: 'kb.mounted' })
    return mount
  },

  unmountKnowledgeBase(input: { projectId: string; kbId: string; actor: string; tool: string; note?: string | null }): { ok: true } {
    const mount = knowledgeMountStore.remove(input.projectId, input.kbId)
    if (!mount) throw new Error('MOUNT_NOT_FOUND')
    recordKnowledgeActivity({
      kbId: input.kbId,
      act: 'unmount',
      actor: input.actor,
      actorType: input.actor === 'human' ? 'human' : 'ai',
      tool: input.tool,
      note: input.note,
    })
    emitUpdate({ projectId: input.projectId, kbId: input.kbId, event: 'kb.unmounted' })
    return { ok: true }
  },

  listActivities(projectId: string, kbId?: string): KnowledgeActivityRow[] {
    const visibleIds = new Set(knowledgeBaseService.listVisibleKnowledgeBases(projectId).map((kb) => kb.id))
    if (kbId) {
      if (!visibleIds.has(kbId)) throw new Error(`KB_NOT_VISIBLE: ${kbId}`)
      return knowledgeActivityStore.list(kbId)
    }
    return [...visibleIds].flatMap((id) => knowledgeActivityStore.list(id))
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
  },

  revertActivity(input: { projectId: string; activityId: string; actor: string; tool: string; note?: string | null }): { reverted: true; page?: KnowledgePageRow; activity: KnowledgeActivityRow } {
    const activity = knowledgeActivityStore.get(input.activityId)
    if (!activity) throw new Error('ACTIVITY_NOT_FOUND')
    if (activity.reverted_at) throw new Error('ACTIVITY_ALREADY_REVERTED')
    assertKbVisible(activity.kb_id, input.projectId)
    if (activity.act === 'create') {
      if (!activity.page_id) throw new Error('REVERT_UNSUPPORTED')
      const page = assertPageVisible(input.projectId, activity.page_id)
      const deleted = knowledgePageStore.update(page.id, { deletedAt: new Date().toISOString() })
      const revert = recordKnowledgeActivity({
        kbId: activity.kb_id,
        pageId: activity.page_id,
        act: 'revert',
        actor: input.actor,
        actorType: input.actor === 'human' ? 'human' : 'ai',
        tool: input.tool,
        note: input.note ?? `Revert ${activity.id}`,
        prevBody: page.body,
        prevSnapshot: snapshotPage(page),
        nextSnapshot: deleted ? snapshotPage(deleted) : null,
      })
      knowledgeActivityStore.markReverted(activity.id, input.actor, revert.id)
      emitUpdate({ projectId: input.projectId, kbId: activity.kb_id, pageId: activity.page_id, event: 'activity.reverted' })
      return { reverted: true, activity: revert }
    }
    if (activity.act !== 'edit' && activity.act !== 'refresh') throw new Error('REVERT_UNSUPPORTED')
    if (!activity.page_id || !activity.prev_snapshot_json) throw new Error('REVERT_UNSUPPORTED')
    const current = assertPageVisible(input.projectId, activity.page_id)
    const snapshot = parseSnapshot(activity.prev_snapshot_json)
    const restored = restorePageSnapshot(current.id, snapshot)
    if (!restored) throw new Error('PAGE_NOT_FOUND')
    const revert = recordKnowledgeActivity({
      kbId: activity.kb_id,
      pageId: current.id,
      act: 'revert',
      actor: input.actor,
      actorType: input.actor === 'human' ? 'human' : 'ai',
      tool: input.tool,
      note: input.note ?? `Revert ${activity.id}`,
      prevBody: current.body,
      prevSnapshot: snapshotPage(current),
      nextSnapshot: snapshotPage(restored),
    })
    const page = knowledgePageStore.update(restored.id, { lastActivityId: revert.id }) ?? restored
    knowledgeActivityStore.markReverted(activity.id, input.actor, revert.id)
    emitUpdate({ projectId: input.projectId, kbId: activity.kb_id, pageId: current.id, event: 'activity.reverted' })
    return { reverted: true, page, activity: revert }
  },
}

function ensureIndexPage(kb: KnowledgeBaseRow, actor: string, actorType: KnowledgeActorType): KnowledgeBaseRow {
  if (kb.index_page_id && knowledgePageStore.get(kb.index_page_id)) return kb
  const page = createIndexPage(kb, actor, actorType)
  return knowledgeBaseStore.setIndexPage(kb.id, page.id) ?? kb
}

function createIndexPage(kb: KnowledgeBaseRow, actor: string, actorType: KnowledgeActorType): KnowledgePageRow {
  return knowledgePageStore.create({
    kbId: kb.id,
    title: `${kb.name} 索引`,
    titleNorm: normalizeTitle(`${kb.name} 索引`),
    section: '入口',
    summary: 'AI 进入知识库时优先阅读这一页',
    body: `# ${kb.name} 索引\n\n这里是 ${kb.name} 的知识入口。`,
    author: actorType === 'human' ? 'human' : 'ai',
    by: actor,
    tags: ['index'],
    isIndex: true,
  })
}

function assertKbVisible(kbId: string, projectId: string): KnowledgeBaseRow {
  const visible = knowledgeBaseService.listVisibleKnowledgeBases(projectId).find((kb) => kb.id === kbId)
  if (!visible) throw new Error(`KB_NOT_VISIBLE: ${kbId}`)
  return visible
}

function assertPageVisible(projectId: string, pageId: string): KnowledgePageRow {
  const page = knowledgePageStore.get(pageId)
  if (!page) throw new Error('PAGE_NOT_FOUND')
  assertKbVisible(page.kb_id, projectId)
  return page
}

function getProjectWorkDir(projectId: string): string {
  const project = projectStore.get(projectId)
  if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectId}`)
  return project.work_dir
}

function emitUpdate(data: Record<string, unknown>): void {
  events.emit('knowledge-base:update', data)
}

