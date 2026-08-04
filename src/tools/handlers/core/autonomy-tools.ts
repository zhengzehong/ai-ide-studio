import { isAbsolute, relative, resolve, sep } from 'node:path'
import { updateAgentAutonomyPlan } from '../../../core/agent-autonomy.js'
import type { AutonomyPlanItem } from '../../../core/agent-autonomy-config.js'
import { events } from '../../../core/events.js'
import { inspectFile, isHiddenPathRel } from '../../../core/filesystem.js'
import {
  autonomyReportStore,
  type AutonomyReportAttachment,
  type AutonomyReportPriority,
} from '../../../store/autonomy-reports.js'
import { sessionStore, type SessionRow } from '../../../store/sessions.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

const MAX_PLAN_ITEMS = 20
const MAX_ATTACHMENTS = 20
const MAX_MARKDOWN_BYTES = 100 * 1024

export const updateAutonomyPlanHandler: ToolHandler = {
  name: 'studio.autonomy.plan.update',
  description: '更新当前自主 Agent 的当天排班。排班只使用 current、next、done 三种状态。',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '排班日期，格式 YYYY-MM-DD' },
      items: {
        type: 'array',
        maxItems: MAX_PLAN_ITEMS,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string', enum: ['current', 'next', 'done'] },
            note: { type: 'string' },
          },
          required: ['id', 'title', 'status'],
        },
      },
      nextCheckAt: { type: 'string', description: '可选，下次希望检查的 ISO 时间，最晚不超过 24 小时' },
    },
    required: ['date', 'items'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const session = requireAutonomyContext(context)
    const date = requiredText(input.date, 'date', 32)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date 必须是 YYYY-MM-DD')
    const items = parsePlanItems(input.items)
    const nextCheckAt = optionalText(input.nextCheckAt, 'nextCheckAt', 64)
    const config = updateAgentAutonomyPlan(session.agent_id, { date, items, nextCheckAt })
    return jsonResult({ plan: config.plan })
  },
}

export const createAutonomyReportHandler: ToolHandler = {
  name: 'studio.autonomy.report',
  description: '提交一条面向用户的自主工作汇报。正文使用 GFM Markdown，优先级只作为标签。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 160 },
      summary: { type: 'string', maxLength: 500 },
      priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      markdown: { type: 'string', description: 'GFM Markdown 正文，最大 100 KiB' },
      attachments: {
        type: 'array',
        maxItems: MAX_ATTACHMENTS,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '项目工作目录内的相对文件路径' },
            title: { type: 'string', maxLength: 160 },
          },
          required: ['path'],
        },
      },
    },
    required: ['title', 'summary', 'priority', 'markdown'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const session = requireAutonomyContext(context)
    const priority = parsePriority(input.priority)
    const markdown = requiredText(input.markdown, 'markdown')
    if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
      throw new Error('markdown 最大 100 KiB')
    }
    const attachments = parseAttachments(input.attachments, context.workDir)
    const report = autonomyReportStore.create({
      projectId: session.project_id as string,
      agentId: session.agent_id,
      sessionId: session.id,
      title: requiredText(input.title, 'title', 160),
      summary: requiredText(input.summary, 'summary', 500),
      priority,
      markdown,
      attachments,
    })
    events.emit('autonomy:update', { agentId: session.agent_id, projectId: session.project_id as string })
    return jsonResult({ report })
  },
}

function requireAutonomyContext(context: ToolContext): SessionRow & { project_id: string } {
  if (!context.sessionId) throw new Error('自主工具需要 Session 上下文')
  const session = sessionStore.get(context.sessionId)
  if (!session || session.purpose !== 'autonomy' || !session.project_id || session.deleted_at) {
    throw new Error('该工具只能在项目自主 Session 中使用')
  }
  if (context.agentId && context.agentId !== session.agent_id) throw new Error('Agent 与自主 Session 不匹配')
  if (context.projectId && context.projectId !== session.project_id) throw new Error('项目与自主 Session 不匹配')
  return session as SessionRow & { project_id: string }
}

function parsePlanItems(value: unknown): AutonomyPlanItem[] {
  if (!Array.isArray(value) || value.length > MAX_PLAN_ITEMS) throw new Error(`items 必须是最多 ${MAX_PLAN_ITEMS} 项的数组`)
  return value.map((item, index) => {
    const record = asRecord(item, `items[${index}]`)
    const status = record.status
    if (status !== 'current' && status !== 'next' && status !== 'done') {
      throw new Error(`items[${index}].status 无效`)
    }
    const note = optionalText(record.note, `items[${index}].note`, 1_000)
    return {
      id: requiredText(record.id, `items[${index}].id`, 100),
      title: requiredText(record.title, `items[${index}].title`, 300),
      status,
      ...(note ? { note } : {}),
    }
  })
}

function parseAttachments(value: unknown, workDir: string | undefined): AutonomyReportAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new Error(`attachments 必须是最多 ${MAX_ATTACHMENTS} 项的数组`)
  }
  if (value.length > 0 && !workDir) throw new Error('附件校验需要项目工作目录')
  const seen = new Set<string>()
  return value.map((item, index) => {
    const record = asRecord(item, `attachments[${index}]`)
    const path = requiredText(record.path, `attachments[${index}].path`, 1_000).replace(/\\/g, '/')
    if (isAbsolute(path) || path.split('/').includes('..') || isHiddenPathRel(path)) {
      throw new Error(`附件路径必须是项目内非隐藏文件: ${path}`)
    }
    const root = resolve(workDir as string)
    const fullPath = resolve(root, path)
    const rel = relative(root, fullPath)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`附件路径不在项目目录内: ${path}`)
    }
    const metadata = inspectFile(root, rel)
    if (!metadata) throw new Error(`附件不存在或不可读取: ${path}`)
    const key = metadata.path.toLocaleLowerCase()
    if (seen.has(key)) throw new Error(`附件路径重复: ${metadata.path}`)
    seen.add(key)
    const title = optionalText(record.title, `attachments[${index}].title`, 160)
    return { path: metadata.path, ...(title ? { title } : {}) }
  })
}

function parsePriority(value: unknown): AutonomyReportPriority {
  if (value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3') return value
  throw new Error('priority 必须是 P0、P1、P2 或 P3')
}

function requiredText(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (maxLength && text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, field, maxLength)
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象`)
  return value as Record<string, unknown>
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
