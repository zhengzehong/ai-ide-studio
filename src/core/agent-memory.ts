import { agentStore } from '../store/agents.js'
import {
  agentMemoryDimensionStore,
  type AgentMemoryDimensionRow,
} from '../store/agent-memory-dimensions.js'
import {
  agentMemoryEntryStore,
  type AgentMemoryEntryRow,
} from '../store/agent-memory-entries.js'
import { BUILTIN_MEMORY_DIMENSIONS } from '../store/agent-memory-builtin-dimensions.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('agent-memory')
export const AGENT_MEMORY_MAX_PINNED = 20
export const AGENT_MEMORY_MAX_DIMENSIONS = 10
const PINNED_MIN_CONFIDENCE = 0.7

export interface AgentMemoryEntrySummary {
  id: string
  title: string
  preview: string
  tags: string[]
  use_count: number
  last_used_at: string | null
  pinned: boolean
  matched_keywords?: string[]
}

export interface AgentMemoryEntryFull {
  id: string
  dimension_id: string
  dimension_name: string
  title: string
  content: string
  tags: string[]
  source_session_id: string | null
  source_task_id: string | null
  confidence: number
  pinned: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

export interface AgentMemoryRecallInput {
  projectId: string
  agentId: string
  dimension: string
  keywords: string[]
  limit?: number
}

export interface AgentMemoryRecordInput {
  projectId: string
  agentId: string
  dimension: string
  title: string
  content: string
  tags?: string[]
  sourceSessionId?: string | null
  sourceTaskId?: string | null
  confidence?: number
}

export interface AgentMemoryUpdateInput {
  projectId: string
  agentId: string
  entryId: string
  title?: string
  content?: string
  tags?: string[]
  confidence?: number
  pinned?: boolean
}

function assertAgentInProject(agentId: string | undefined, projectId: string): void {
  if (!agentId) throw new Error('agentId is required')
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`AGENT_NOT_FOUND: ${agentId}`)
  if (agent.project_id !== projectId) {
    throw new Error(`PROJECT_MISMATCH: Agent ${agentId} is outside project ${projectId}`)
  }
}

function resolveDimension(projectId: string, agentId: string, name: string): AgentMemoryDimensionRow {
  const dim = agentMemoryDimensionStore.getByNames(projectId, agentId, name)
  if (!dim) throw new Error(`DIMENSION_NOT_FOUND: ${name}`)
  return dim
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function previewOf(content: string, n = 200): string {
  const text = content.replace(/[#`*>-]/g, '').replace(/\n+/g, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

function toSummary(row: AgentMemoryEntryRow, matched?: string[]): AgentMemoryEntrySummary {
  return {
    id: row.id,
    title: row.title,
    preview: previewOf(row.content),
    tags: parseTags(row.tags),
    use_count: row.use_count,
    last_used_at: row.last_used_at,
    pinned: row.pinned === 1,
    matched_keywords: matched,
  }
}

function toFull(row: AgentMemoryEntryRow, dimensionName: string): AgentMemoryEntryFull {
  return {
    id: row.id,
    dimension_id: row.dimension_id,
    dimension_name: dimensionName,
    title: row.title,
    content: row.content,
    tags: parseTags(row.tags),
    source_session_id: row.source_session_id,
    source_task_id: row.source_task_id,
    confidence: row.confidence,
    pinned: row.pinned === 1,
    use_count: row.use_count,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  }
}

export const agentMemoryService = {
  listDimensions(projectId: string, agentId: string): AgentMemoryDimensionRow[] {
    assertAgentInProject(agentId, projectId)
    return agentMemoryDimensionStore.listByAgent(projectId, agentId)
  },

  createDimension(input: {
    projectId: string
    agentId: string
    name: string
    description?: string | null
    prompt?: string | null
  }): AgentMemoryDimensionRow {
    assertAgentInProject(input.agentId, input.projectId)
    const existing = agentMemoryDimensionStore.getByNames(input.projectId, input.agentId, input.name)
    if (existing) throw new Error(`DIMENSION_EXISTS: ${input.name}`)
    return agentMemoryDimensionStore.create({
      projectId: input.projectId,
      agentId: input.agentId,
      name: input.name,
      description: input.description ?? null,
      prompt: input.prompt ?? null,
    })
  },

  defineDimension(input: {
    projectId: string
    agentId: string
    name: string
    description: string
    prompt: string
  }): AgentMemoryDimensionRow {
    assertAgentInProject(input.agentId, input.projectId)
    const count = agentMemoryDimensionStore.countCustomByAgent(input.projectId, input.agentId)
    if (count >= AGENT_MEMORY_MAX_DIMENSIONS) {
      throw new Error(`DIMENSION_LIMIT_EXCEEDED: max ${AGENT_MEMORY_MAX_DIMENSIONS}, current ${count}`)
    }
    const existing = agentMemoryDimensionStore.getByNames(input.projectId, input.agentId, input.name)
    if (existing) throw new Error(`维度已存在: ${input.name}`)
    const dim = agentMemoryDimensionStore.create({
      projectId: input.projectId,
      agentId: input.agentId,
      name: input.name,
      description: input.description,
      prompt: input.prompt,
    })
    log.info({ dimensionId: dim.id, agentId: input.agentId, name: input.name }, 'agent memory dimension defined by AI')
    return dim
  },

  updateDimension(input: {
    projectId: string
    agentId: string
    dimensionId: string
    name?: string
    description?: string | null
    prompt?: string | null
  }): AgentMemoryDimensionRow {
    assertAgentInProject(input.agentId, input.projectId)
    const current = agentMemoryDimensionStore.get(input.dimensionId)
    if (!current) throw new Error(`DIMENSION_NOT_FOUND: ${input.dimensionId}`)
    if (current.project_id !== input.projectId || current.agent_id !== input.agentId) {
      throw new Error('DIMENSION_OWNERSHIP_MISMATCH')
    }
    if (input.name && input.name !== current.name) {
      const dup = agentMemoryDimensionStore.getByNames(input.projectId, input.agentId, input.name)
      if (dup) throw new Error(`DIMENSION_EXISTS: ${input.name}`)
    }
    return agentMemoryDimensionStore.update(input.dimensionId, {
      name: input.name,
      description: input.description,
      prompt: input.prompt,
    })!
  },

  deleteDimension(input: { projectId: string; agentId: string; dimensionId: string }): void {
    assertAgentInProject(input.agentId, input.projectId)
    const current = agentMemoryDimensionStore.get(input.dimensionId)
    if (!current) return
    if (current.project_id !== input.projectId || current.agent_id !== input.agentId) {
      throw new Error('DIMENSION_OWNERSHIP_MISMATCH')
    }
    if (current.is_builtin === 1) {
      throw new Error(`BUILTIN_DIMENSION_CANNOT_DELETE: ${current.name}`)
    }
    agentMemoryDimensionStore.softDelete(input.dimensionId)
  },

  seedBuiltinDimensions(projectId: string, agentId: string): AgentMemoryDimensionRow[] {
    assertAgentInProject(agentId, projectId)
    const created: AgentMemoryDimensionRow[] = []
    for (const def of BUILTIN_MEMORY_DIMENSIONS) {
      const existing = agentMemoryDimensionStore.getByNames(projectId, agentId, def.name)
      if (existing) {
        log.info({ agentId, name: def.name, existingId: existing.id }, '内置维度已存在,跳过 seed')
        continue
      }
      try {
        const dim = agentMemoryDimensionStore.create({
          projectId,
          agentId,
          name: def.name,
          description: def.description,
          prompt: def.prompt,
          isBuiltin: true,
        })
        created.push(dim)
      } catch (err) {
        log.error({ agentId, name: def.name, err }, '内置维度 seed 失败')
      }
    }
    if (created.length > 0) {
      log.info({ agentId, seeded: created.length }, '内置记忆维度已 seed')
    }
    return created
  },

  listEntries(projectId: string, agentId: string, dimension: string): AgentMemoryEntrySummary[] {
    assertAgentInProject(agentId, projectId)
    const dim = resolveDimension(projectId, agentId, dimension)
    return agentMemoryEntryStore.listByDimension(dim.id).map((row) => toSummary(row))
  },

  getEntry(projectId: string, agentId: string, entryId: string): AgentMemoryEntryFull {
    assertAgentInProject(agentId, projectId)
    const entry = agentMemoryEntryStore.get(entryId)
    if (!entry) throw new Error(`ENTRY_NOT_FOUND: ${entryId}`)
    const dim = agentMemoryDimensionStore.get(entry.dimension_id)
    if (!dim || dim.project_id !== projectId || dim.agent_id !== agentId) {
      throw new Error('ENTRY_OWNERSHIP_MISMATCH')
    }
    return toFull(entry, dim.name)
  },

  recordEntry(input: AgentMemoryRecordInput): AgentMemoryEntryFull {
    assertAgentInProject(input.agentId, input.projectId)
    const dim = resolveDimension(input.projectId, input.agentId, input.dimension)
    const entry = agentMemoryEntryStore.create({
      dimensionId: dim.id,
      title: input.title,
      content: input.content,
      tags: input.tags,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceTaskId: input.sourceTaskId ?? null,
      confidence: input.confidence,
      pinned: false,
    })
    log.info({ entryId: entry.id, dimensionId: dim.id }, 'agent memory recorded')
    return toFull(entry, dim.name)
  },

  updateEntry(input: AgentMemoryUpdateInput): AgentMemoryEntryFull {
    assertAgentInProject(input.agentId, input.projectId)
    const entry = agentMemoryEntryStore.get(input.entryId)
    if (!entry) throw new Error(`ENTRY_NOT_FOUND: ${input.entryId}`)
    const dim = agentMemoryDimensionStore.get(entry.dimension_id)
    if (!dim || dim.project_id !== input.projectId || dim.agent_id !== input.agentId) {
      throw new Error('ENTRY_OWNERSHIP_MISMATCH')
    }
    if (input.pinned !== undefined) {
      const willPin = input.pinned && entry.pinned !== 1
      if (willPin) {
        const allDims = agentMemoryDimensionStore.listByAgent(input.projectId, input.agentId)
        const dimIds = allDims.map((d) => d.id)
        const count = agentMemoryEntryStore.countPinnedByDimensions(dimIds)
        if (count >= AGENT_MEMORY_MAX_PINNED) {
          throw new Error(`PINNED_LIMIT_EXCEEDED: max ${AGENT_MEMORY_MAX_PINNED}`)
        }
      }
    }
    const updated = agentMemoryEntryStore.update(input.entryId, {
      title: input.title,
      content: input.content,
      tags: input.tags,
      confidence: input.confidence,
      pinned: input.pinned,
    })!
    return toFull(updated, dim.name)
  },

  deleteEntry(input: { projectId: string; agentId: string; entryId: string }): void {
    assertAgentInProject(input.agentId, input.projectId)
    const entry = agentMemoryEntryStore.get(input.entryId)
    if (!entry) return
    const dim = agentMemoryDimensionStore.get(entry.dimension_id)
    if (!dim || dim.project_id !== input.projectId || dim.agent_id !== input.agentId) {
      throw new Error('ENTRY_OWNERSHIP_MISMATCH')
    }
    agentMemoryEntryStore.softDelete(input.entryId)
  },

  setPinned(input: { projectId: string; agentId: string; entryId: string; pinned: boolean }): AgentMemoryEntryFull {
    return agentMemoryService.updateEntry({
      projectId: input.projectId,
      agentId: input.agentId,
      entryId: input.entryId,
      pinned: input.pinned,
    })
  },

  recall(input: AgentMemoryRecallInput): AgentMemoryEntrySummary[] {
    assertAgentInProject(input.agentId, input.projectId)
    const dim = resolveDimension(input.projectId, input.agentId, input.dimension)
    const limit = input.limit && input.limit > 0 ? input.limit : 5
    const keywords = (input.keywords ?? [])
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
    if (keywords.length === 0) return []

    const hitMap = new Map<string, { score: number; matched: Set<string> }>()
    for (const kw of keywords) {
      let hits: Array<{ entry_id: string; score: number }> = []
      if (kw.length >= 3) {
        hits = agentMemoryEntryStore.searchByFts([dim.id], sanitizeFtsQuery(kw))
      }
      if (hits.length === 0) {
        hits = agentMemoryEntryStore.searchByLike([dim.id], kw)
      }
      for (const h of hits) {
        const item = hitMap.get(h.entry_id) ?? { score: 0, matched: new Set<string>() }
        item.score += h.score
        item.matched.add(kw)
        hitMap.set(h.entry_id, item)
      }
    }

    const ranked = [...hitMap.entries()]
      .map(([entryId, v]) => ({ entryId, score: v.score, matchedCount: v.matched.size, matched: v.matched }))
      .sort((a, b) => b.matchedCount - a.matchedCount || a.score - b.score)
      .slice(0, limit)

    if (ranked.length > 0) {
      agentMemoryEntryStore.touchUsed(ranked.map((r) => r.entryId))
    }

    return ranked.map((r) => {
      const row = agentMemoryEntryStore.get(r.entryId)!
      return toSummary(row, [...r.matched])
    })
  },

  buildAgentMemoryPrompt(agentId: string): string {
    const agent = agentStore.get(agentId)
    if (!agent || !agent.project_id) return ''
    const dims = agentMemoryDimensionStore.listByAgent(agent.project_id, agentId)
    if (dims.length === 0) return ''

    const dimIds = dims.map((d) => d.id)
    const pinnedRows = agentMemoryEntryStore
      .listPinnedByDimensions(dimIds)
      .filter((e) => e.confidence >= PINNED_MIN_CONFIDENCE)
      .slice(0, AGENT_MEMORY_MAX_PINNED)

    const dimSection = dims
      .map((d) => {
        const header = `### 维度: ${d.name}`
        const body = (d.prompt || d.description || '').trim()
        return body ? `${header}\n${body}` : header
      })
      .join('\n\n')

    const toolSection = [
      '工具：',
      '- recall_memory(dimension, keywords, limit?) — 按关键词查询,返回摘要',
      '- list_memory(dimension, limit?) — 列出某维度所有条目摘要',
      '- get_memory(entry_id) — 取单条目完整 MD 内容',
      '- record_memory(dimension, title, content, tags?) — 记录新条目(content 支持 MD)',
      '- update_memory(entry_id, title?, content?, tags?) — 更新条目(content 支持 MD)',
      '- delete_memory(entry_id) — 删除条目',
      '',
      '你可以调用 define_memory_dimension 为自己新增维度(仅当现有维度装不下时)。不要为单条信息建维度,优先 record 到已有维度。维度上限 10 个。',
    ].join('\n')

    const pinnedSection = pinnedRows.length === 0
      ? '（暂无置顶记忆。需要时通过 recall_memory 查询。）'
      : pinnedRows
          .map((e) => {
            const dim = dims.find((d) => d.id === e.dimension_id)
            return `- [${dim?.name ?? '?'}] ${e.title}`
          })
          .join('\n')

    return [
      '## 你的 Agent 记忆',
      '你按以下维度记录和使用记忆：',
      '',
      dimSection,
      '',
      toolSection,
      '',
      '## 置顶记忆（永久生效，不占用对话）',
      pinnedSection,
      '（其余记忆通过 recall_memory 查询，不在此列出）',
    ].join('\n')
  },
}

function sanitizeFtsQuery(keyword: string): string {
  return keyword.replace(/["*]/g, ' ').trim()
}
