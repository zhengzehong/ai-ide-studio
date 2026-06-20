import { knowledgeBaseService } from '../../core/knowledge-base.js'
import { knowledgeBaseStore } from '../../store/knowledge-bases.js'
import type { KnowledgeBaseKind, KnowledgeBaseSource } from '../../store/knowledge-bases.js'
import type { RpcHandlerMap } from './types.js'

export const knowledgeBaseRpcHandlers: RpcHandlerMap = {
  'knowledgeBases.list'(msg, { sendResult }) {
    sendResult({ knowledgeBases: knowledgeBaseService.listVisibleKnowledgeBases(requireString(msg.projectId, 'projectId')) })
  },

  'knowledgeBases.shared'(_msg, { sendResult }) {
    sendResult({ knowledgeBases: knowledgeBaseStore.listShared() })
  },

  'knowledgeBases.create'(msg, { sendResult }) {
    const kind = requireKnowledgeBaseKind(msg.kind)
    const kb = knowledgeBaseService.createKnowledgeBase({
      name: requireString(msg.name, 'name'),
      kind,
      src: requireKnowledgeBaseSource(msg.src),
      projectId: kind === 'project' ? requireString(msg.projectId, 'projectId') : optionalString(msg.projectId),
      icon: optionalNullableString(msg.icon),
      description: optionalNullableString(msg.description),
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    })
    sendResult({ kb })
  },

  'knowledgeBases.mount'(msg, { sendResult }) {
    const mount = knowledgeBaseService.mountKnowledgeBase({
      projectId: requireString(msg.projectId, 'projectId'),
      kbId: requireString(msg.kbId, 'kbId'),
      actor: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    })
    sendResult({ mount })
  },

  'knowledgeBases.unmount'(msg, { sendResult }) {
    sendResult(knowledgeBaseService.unmountKnowledgeBase({
      projectId: requireString(msg.projectId, 'projectId'),
      kbId: requireString(msg.kbId, 'kbId'),
      actor: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    }))
  },

  'knowledgePages.list'(msg, { sendResult }) {
    sendResult({
      pages: knowledgeBaseService.listPages(requireString(msg.projectId, 'projectId'), requireString(msg.kbId, 'kbId')),
    })
  },

  'knowledgePages.read'(msg, { sendResult }) {
    sendResult(knowledgeBaseService.readPage({
      projectId: requireString(msg.projectId, 'projectId'),
      pageId: optionalString(msg.pageId),
      kbId: optionalString(msg.kbId),
      title: optionalString(msg.title),
    }))
  },

  'knowledgePages.search'(msg, { sendResult }) {
    sendResult({
      pages: knowledgeBaseService.search({
        projectId: requireString(msg.projectId, 'projectId'),
        query: requireString(msg.query, 'query'),
        kbIds: optionalStringArray(msg.kbIds),
        limit: optionalNumber(msg.limit),
      }),
    })
  },

  'knowledgePages.create'(msg, { sendResult }) {
    sendResult(knowledgeBaseService.createPage({
      projectId: requireString(msg.projectId, 'projectId'),
      kbId: requireString(msg.kbId, 'kbId'),
      title: requireString(msg.title, 'title'),
      section: optionalNullableString(msg.section),
      summary: optionalNullableString(msg.summary),
      body: requireString(msg.body, 'body'),
      tags: optionalStringArray(msg.tags),
      srcFiles: optionalStringArray(msg.srcFiles),
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    }))
  },

  'knowledgePages.update'(msg, { sendResult }) {
    sendResult(knowledgeBaseService.updatePage({
      projectId: requireString(msg.projectId, 'projectId'),
      pageId: requireString(msg.pageId, 'pageId'),
      title: optionalString(msg.title),
      section: optionalNullableString(msg.section),
      summary: optionalNullableString(msg.summary),
      body: requireString(msg.body, 'body'),
      tags: optionalStringArray(msg.tags),
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    }))
  },

  'knowledgePages.refreshFromCode'(msg, { sendResult }) {
    sendResult(knowledgeBaseService.refreshFromCode({
      projectId: requireString(msg.projectId, 'projectId'),
      pageId: requireString(msg.pageId, 'pageId'),
      body: requireString(msg.body, 'body'),
      srcFiles: optionalStringArray(msg.srcFiles),
      confirmOverwriteHumanEdit: optionalBoolean(msg.confirmOverwriteHumanEdit),
      actor: 'human',
      actorType: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    }))
  },

  'knowledgeActivities.list'(msg, { sendResult }) {
    sendResult({
      activities: knowledgeBaseService.listActivities(requireString(msg.projectId, 'projectId'), optionalString(msg.kbId)),
    })
  },

  'knowledgeActivities.revert'(msg, { sendResult }) {
    sendResult(knowledgeBaseService.revertActivity({
      projectId: requireString(msg.projectId, 'projectId'),
      activityId: requireString(msg.activityId, 'activityId'),
      actor: 'human',
      tool: 'manual',
      note: optionalNullableString(msg.note),
    }))
  },
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function requireKnowledgeBaseKind(value: unknown): KnowledgeBaseKind {
  if (value === 'project' || value === 'shared') return value
  throw new Error('kind must be project or shared')
}

function requireKnowledgeBaseSource(value: unknown): KnowledgeBaseSource {
  if (value === 'manual' || value === 'code') return value
  throw new Error('src must be manual or code')
}
