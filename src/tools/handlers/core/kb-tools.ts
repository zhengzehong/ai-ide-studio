import { knowledgeBaseService } from '../../../core/knowledge-base.js'
import { agentStore } from '../../../store/agents.js'
import type { KnowledgeBaseKind, KnowledgeBaseSource } from '../../../store/knowledge-bases.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listKnowledgeBasesHandler: ToolHandler = {
  name: 'core.kb.list',
  description: 'List visible knowledge bases for the current project.',
  inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveProjectId(input, context)
    return jsonResult({ knowledgeBases: knowledgeBaseService.listVisibleKnowledgeBases(projectId) })
  },
}

export const readKnowledgeIndexHandler: ToolHandler = {
  name: 'core.kb.read_index',
  description: 'Read the index page of a visible knowledge base.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      kbId: { type: 'string' },
    },
    required: ['kbId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveProjectId(input, context)
    const result = knowledgeBaseService.readIndex(projectId, requireString(input, 'kbId'))
    return jsonResult(result)
  },
}

export const readKnowledgePageHandler: ToolHandler = {
  name: 'core.kb.read_page',
  description: 'Read a knowledge page by page id or by kb id plus title.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      pageId: { type: 'string' },
      kbId: { type: 'string' },
      title: { type: 'string' },
    },
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveProjectId(input, context)
    const result = knowledgeBaseService.readPage({
      projectId,
      pageId: optionalString(input, 'pageId'),
      kbId: optionalString(input, 'kbId'),
      title: optionalString(input, 'title'),
    })
    return jsonResult(result)
  },
}

export const searchKnowledgePagesHandler: ToolHandler = {
  name: 'core.kb.search',
  description: 'Search visible knowledge pages using SQL LIKE.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      query: { type: 'string' },
      kbIds: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
    },
    required: ['query'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveProjectId(input, context)
    const pages = knowledgeBaseService.search({
      projectId,
      query: requireString(input, 'query'),
      kbIds: optionalStringArray(input, 'kbIds'),
      limit: optionalNumber(input, 'limit'),
    })
    return jsonResult({ pages })
  },
}

export const createKnowledgePageHandler: ToolHandler = {
  name: 'core.kb.create_page',
  description: 'Create a markdown knowledge page and record an activity entry.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      kbId: { type: 'string' },
      title: { type: 'string' },
      section: { type: 'string' },
      summary: { type: 'string' },
      body: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      srcFiles: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
    },
    required: ['kbId', 'title', 'body'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(input, context)
    const result = knowledgeBaseService.createPage({
      projectId,
      kbId: requireString(input, 'kbId'),
      title: requireString(input, 'title'),
      section: optionalNullableString(input, 'section'),
      summary: optionalNullableString(input, 'summary'),
      body: requireString(input, 'body'),
      tags: optionalStringArray(input, 'tags'),
      srcFiles: optionalStringArray(input, 'srcFiles'),
      actor: resolveActor(context),
      actorType: 'ai',
      tool: 'core.kb.create_page',
      note: optionalNullableString(input, 'note'),
    })
    return jsonResult(result)
  },
}

export const updateKnowledgePageHandler: ToolHandler = {
  name: 'core.kb.update_page',
  description: 'Update a knowledge page and record an activity entry.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      pageId: { type: 'string' },
      title: { type: 'string' },
      section: { type: 'string' },
      summary: { type: 'string' },
      body: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
    },
    required: ['pageId', 'body'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(input, context)
    const result = knowledgeBaseService.updatePage({
      projectId,
      pageId: requireString(input, 'pageId'),
      title: optionalString(input, 'title'),
      section: optionalNullableString(input, 'section'),
      summary: optionalNullableString(input, 'summary'),
      body: requireString(input, 'body'),
      tags: optionalStringArray(input, 'tags'),
      actor: resolveActor(context),
      actorType: 'ai',
      tool: 'core.kb.update_page',
      note: optionalNullableString(input, 'note'),
    })
    return jsonResult(result)
  },
}

export const refreshKnowledgeFromCodeHandler: ToolHandler = {
  name: 'core.kb.refresh_from_code',
  description: 'Refresh a code-sourced knowledge page after the caller has read current source files.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      pageId: { type: 'string' },
      body: { type: 'string' },
      srcFiles: { type: 'array', items: { type: 'string' } },
      confirmOverwriteHumanEdit: { type: 'boolean' },
      note: { type: 'string' },
    },
    required: ['pageId', 'body'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(input, context)
    const result = knowledgeBaseService.refreshFromCode({
      projectId,
      pageId: requireString(input, 'pageId'),
      body: requireString(input, 'body'),
      srcFiles: optionalStringArray(input, 'srcFiles'),
      confirmOverwriteHumanEdit: optionalBoolean(input, 'confirmOverwriteHumanEdit'),
      actor: resolveActor(context),
      actorType: 'ai',
      tool: 'core.kb.refresh_from_code',
      note: optionalNullableString(input, 'note'),
    })
    return jsonResult(result)
  },
}

export const createKnowledgeBaseHandler: ToolHandler = {
  name: 'core.kb.create_kb',
  description: 'Create a project or shared knowledge base.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      name: { type: 'string' },
      kind: { type: 'string', enum: ['project', 'shared'] },
      src: { type: 'string', enum: ['manual', 'code'] },
      icon: { type: 'string' },
      description: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['name', 'kind', 'src'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const kind = requireKnowledgeBaseKind(input.kind)
    const actorProjectId = resolveWriteProjectId(input, context)
    const kb = knowledgeBaseService.createKnowledgeBase({
      name: requireString(input, 'name'),
      kind,
      src: requireKnowledgeBaseSource(input.src),
      projectId: kind === 'project' ? actorProjectId : optionalString(input, 'projectId'),
      icon: optionalNullableString(input, 'icon'),
      description: optionalNullableString(input, 'description'),
      actor: resolveActor(context),
      actorType: 'ai',
      tool: 'core.kb.create_kb',
      note: optionalNullableString(input, 'note'),
    })
    return jsonResult({ kb })
  },
}

export const mountKnowledgeBaseHandler: ToolHandler = {
  name: 'core.kb.mount',
  description: 'Mount a shared knowledge base into the current project.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      kbId: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['kbId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(input, context)
    const mount = knowledgeBaseService.mountKnowledgeBase({
      projectId,
      kbId: requireString(input, 'kbId'),
      actor: resolveActor(context),
      tool: 'core.kb.mount',
      note: optionalNullableString(input, 'note'),
    })
    return jsonResult({ mount })
  },
}

export const unmountKnowledgeBaseHandler: ToolHandler = {
  name: 'core.kb.unmount',
  description: 'Unmount a shared knowledge base from the current project.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      kbId: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['kbId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(input, context)
    return jsonResult(knowledgeBaseService.unmountKnowledgeBase({
      projectId,
      kbId: requireString(input, 'kbId'),
      actor: resolveActor(context),
      tool: 'core.kb.unmount',
      note: optionalNullableString(input, 'note'),
    }))
  },
}

export const revertKnowledgeActivityHandler: ToolHandler = {
  name: 'core.kb.revert',
  description: 'Revert a previous knowledge base activity.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      activityId: { type: 'string' },
      note: { type: 'string' },
    },
    required: ['activityId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const projectId = resolveWriteProjectId(input, context)
    const result = knowledgeBaseService.revertActivity({
      projectId,
      activityId: requireString(input, 'activityId'),
      actor: resolveActor(context),
      tool: 'core.kb.revert',
      note: optionalNullableString(input, 'note'),
    })
    return jsonResult(result)
  },
}

function resolveProjectId(input: ToolHandlerInput, context: ToolContext): string {
  const projectId = context.projectId ?? optionalString(input, 'projectId')
  if (!projectId) throw new Error('projectId is required')
  return projectId
}

function resolveWriteProjectId(input: ToolHandlerInput, context: ToolContext): string {
  const projectId = resolveProjectId(input, context)
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

function optionalNullableString(input: ToolHandlerInput, key: string): string | null | undefined {
  const value = input[key]
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(input: ToolHandlerInput, key: string): string[] | undefined {
  const value = input[key]
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
}

function optionalNumber(input: ToolHandlerInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(input: ToolHandlerInput, key: string): boolean | undefined {
  const value = input[key]
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

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
