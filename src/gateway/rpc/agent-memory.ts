import { agentMemoryService, AGENT_MEMORY_MAX_PINNED } from '../../core/agent-memory.js'
import type { RpcHandlerMap } from './types.js'

export const agentMemoryRpcHandlers: RpcHandlerMap = {
  'agentMemory.dimensions.list'(msg, { sendResult }) {
    const projectId = requireString(msg.projectId, 'projectId')
    const agentId = requireString(msg.agentId, 'agentId')
    sendResult({ dimensions: agentMemoryService.listDimensions(projectId, agentId) })
  },

  'agentMemory.dimensions.create'(msg, { sendResult }) {
    const dim = agentMemoryService.createDimension({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      name: requireString(msg.name, 'name'),
      description: optionalNullableString(msg.description),
      prompt: optionalNullableString(msg.prompt),
    })
    sendResult({ dimension: dim })
  },

  'agentMemory.dimensions.update'(msg, { sendResult }) {
    const dim = agentMemoryService.updateDimension({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      dimensionId: requireString(msg.dimensionId, 'dimensionId'),
      name: optionalString(msg.name),
      description: optionalNullableString(msg.description),
      prompt: optionalNullableString(msg.prompt),
    })
    sendResult({ dimension: dim })
  },

  'agentMemory.dimensions.delete'(msg, { sendResult }) {
    agentMemoryService.deleteDimension({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      dimensionId: requireString(msg.dimensionId, 'dimensionId'),
    })
    sendResult({ ok: true })
  },

  'agentMemory.entries.list'(msg, { sendResult }) {
    const projectId = requireString(msg.projectId, 'projectId')
    const agentId = requireString(msg.agentId, 'agentId')
    const dimension = requireString(msg.dimension, 'dimension')
    sendResult({
      entries: agentMemoryService.listEntries(projectId, agentId, dimension),
      pinnedLimit: AGENT_MEMORY_MAX_PINNED,
    })
  },

  'agentMemory.entries.get'(msg, { sendResult }) {
    const entry = agentMemoryService.getEntry(
      requireString(msg.projectId, 'projectId'),
      requireString(msg.agentId, 'agentId'),
      requireString(msg.entryId, 'entryId'),
    )
    sendResult({ entry })
  },

  'agentMemory.entries.create'(msg, { sendResult }) {
    const entry = agentMemoryService.recordEntry({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      dimension: requireString(msg.dimension, 'dimension'),
      title: requireString(msg.title, 'title'),
      content: requireString(msg.content, 'content'),
      tags: optionalStringArray(msg.tags),
      confidence: optionalNumber(msg.confidence),
    })
    sendResult({ entry })
  },

  'agentMemory.entries.update'(msg, { sendResult }) {
    const entry = agentMemoryService.updateEntry({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      entryId: requireString(msg.entryId, 'entryId'),
      title: optionalString(msg.title),
      content: optionalString(msg.content),
      tags: optionalStringArray(msg.tags),
      confidence: optionalNumber(msg.confidence),
      pinned: optionalBoolean(msg.pinned),
      injectFull: optionalBoolean(msg.injectFull),
    })
    sendResult({ entry })
  },

  'agentMemory.entries.delete'(msg, { sendResult }) {
    agentMemoryService.deleteEntry({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      entryId: requireString(msg.entryId, 'entryId'),
    })
    sendResult({ ok: true })
  },

  'agentMemory.entries.recall'(msg, { sendResult }) {
    const entries = agentMemoryService.recall({
      projectId: requireString(msg.projectId, 'projectId'),
      agentId: requireString(msg.agentId, 'agentId'),
      dimension: requireString(msg.dimension, 'dimension'),
      keywords: optionalStringArray(msg.keywords) ?? [],
      limit: optionalNumber(msg.limit),
    })
    sendResult({ entries })
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
