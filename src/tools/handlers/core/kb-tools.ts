import { knowledgeBaseService } from '../../../core/knowledge-base.js'
import { parseJsonArray } from '../../../core/knowledge-base-utils.js'
import { agentStore } from '../../../store/agents.js'
import type { KnowledgeBaseRow } from '../../../store/knowledge-bases.js'
import type { KnowledgePageRow } from '../../../store/knowledge-pages.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listKnowledgeBasesHandler: ToolHandler = {
  name: 'core.kb.list',
  description: '列出当前项目可见的知识库和页面目录，不返回页面正文。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async execute(_input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveProjectId(context)
    const knowledgeBases = knowledgeBaseService.listVisibleKnowledgeBases(projectId).map((kb) => ({
      ...toKnowledgeBaseSummary(kb),
      pages: knowledgeBaseService.listPages(projectId, kb.id).map(toPageSummary),
    }))
    return jsonResult({ knowledgeBases })
  },
}

export const readKnowledgePageHandler: ToolHandler = {
  name: 'core.kb.read',
  description: '按页面 ID 读取当前项目可见的知识库页面。',
  inputSchema: {
    type: 'object',
    properties: { pageId: { type: 'string', description: '页面 ID' } },
    required: ['pageId'],
    additionalProperties: false,
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    return jsonResult(knowledgeBaseService.readPage({
      projectId: resolveProjectId(context),
      pageId: requireString(input, 'pageId'),
    }))
  },
}

export const upsertKnowledgePageHandler: ToolHandler = {
  name: 'core.kb.upsert',
  description: '新增或修改知识库页面；传 pageId 时修改，否则新增。',
  inputSchema: {
    type: 'object',
    properties: {
      kbId: { type: 'string', description: '新增页面所属的知识库 ID' },
      pageId: { type: 'string', description: '要修改的页面 ID' },
      title: { type: 'string', description: '页面标题' },
      section: { type: 'string', description: '页面分区' },
      summary: { type: 'string', description: '页面摘要' },
      body: { type: 'string', description: 'Markdown 正文' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签' },
    },
    additionalProperties: false,
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(context)
    const actor = resolveActor(context)
    const pageId = optionalString(input, 'pageId')
    if (!pageId) {
      return jsonResult(knowledgeBaseService.createPage({
        projectId,
        kbId: requireString(input, 'kbId'),
        title: requireString(input, 'title'),
        section: optionalNullableString(input, 'section'),
        summary: optionalNullableString(input, 'summary'),
        body: requireString(input, 'body'),
        tags: optionalStringArray(input, 'tags'),
        actor,
        actorType: 'ai',
        tool: 'core.kb.upsert',
      }))
    }

    const current = knowledgeBaseService.readPage({ projectId, pageId }).page
    return jsonResult(knowledgeBaseService.updatePage({
      projectId,
      pageId,
      title: optionalString(input, 'title') ?? current.title,
      section: input.section !== undefined ? optionalNullableString(input, 'section') : current.section,
      summary: input.summary !== undefined ? optionalNullableString(input, 'summary') : current.summary,
      body: optionalRawString(input, 'body') ?? current.body,
      tags: input.tags !== undefined ? optionalStringArray(input, 'tags') : parseJsonArray(current.tags_json),
      actor,
      actorType: 'ai',
      tool: 'core.kb.upsert',
    }))
  },
}

export const deleteKnowledgePageHandler: ToolHandler = {
  name: 'core.kb.delete',
  description: '按页面 ID 软删除知识库页面；索引页不能删除。',
  inputSchema: {
    type: 'object',
    properties: { pageId: { type: 'string', description: '页面 ID' } },
    required: ['pageId'],
    additionalProperties: false,
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    return jsonResult(knowledgeBaseService.deletePage({
      projectId: resolveWriteProjectId(context),
      pageId: requireString(input, 'pageId'),
      actor: resolveActor(context),
      actorType: 'ai',
      tool: 'core.kb.delete',
    }))
  },
}

function toKnowledgeBaseSummary(kb: KnowledgeBaseRow): Record<string, unknown> {
  return {
    id: kb.id,
    name: kb.name,
    kind: kb.kind,
    src: kb.src,
    icon: kb.icon,
    description: kb.description,
  }
}

function toPageSummary(page: KnowledgePageRow): Record<string, unknown> {
  return {
    id: page.id,
    title: page.title,
    section: page.section,
    summary: page.summary,
    tags: parseJsonArray(page.tags_json),
    stale: page.stale === 1,
    isIndex: page.is_index === 1,
  }
}

function resolveProjectId(context: ToolContext): string {
  if (!context.projectId) throw new Error('projectId is required in tool context')
  return context.projectId
}

function resolveWriteProjectId(context: ToolContext): string {
  const projectId = resolveProjectId(context)
  assertAgentInProject(context.agentId, projectId)
  return projectId
}

function assertAgentInProject(agentId: string | undefined, projectId: string): void {
  if (!agentId) return
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (agent.project_id !== projectId) throw new Error(`Project mismatch: Agent ${agentId} is outside current project`)
}

function resolveActor(context: ToolContext): string {
  return context.agentId ?? 'ai'
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value.trim()
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalRawString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function optionalNullableString(input: ToolHandlerInput, key: string): string | null | undefined {
  const value = input[key]
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(input: ToolHandlerInput, key: string): string[] | undefined {
  const value = input[key]
  if (!Array.isArray(value)) return undefined
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
