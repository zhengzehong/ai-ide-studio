import { publishSuggestions } from '../../core/project-advisor.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

const MAX_SUGGESTIONS = 3
const MAX_EVIDENCE = 5

export const suggestionPresentHandler: ToolHandler = {
  name: 'suggestion.present',
  description: '提交本轮参谋建议（每轮最多 3 条，可传空数组表示无货沉默并填 noFindingReason）。同一轮重复调用以最后一次为准；禁止测试或占位内容。plan 类型建议必须同时提交 artifactName 和 artifactHtml。',
  inputSchema: {
    type: 'object',
    properties: {
      roundId: { type: 'string', description: '提示中提供的轮次 ID' },
      noFindingReason: { type: 'string', description: 'suggestions 为空时必填：为什么本轮没有值得建议的内容' },
      suggestions: {
        type: 'array',
        maxItems: MAX_SUGGESTIONS,
        description: '每轮 0-3 条，上限不是目标。提交前核实新增事实、证据、现有任务未覆盖、具体收益和最小下一步。当前工作的执行细节与传话类不提交；没有足够价值时传空数组。',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['plan', 'action'], description: 'plan=附完整 HTML 方案文档（需打开看再决策）；action=说明即执行包，可直接执行' },
            title: { type: 'string', description: '建议标题（即任务标题，≤160 字符）' },
            descriptionMarkdown: { type: 'string', description: '预填执行包：背景/实施步骤/交付物/验收标准。执行 Agent 没有参谋的调查上下文，必须自带完整事实链（文件:行号、报错原文、任务/会话 ID）与分步方案，至少 400 字符' },
            suggestedAgentId: { type: 'string', description: '当前项目内推荐执行 Agent ID' },
            agentReason: { type: 'string', description: '推荐该 Agent 的理由' },
            sourceEvidence: {
              type: 'array',
              maxItems: MAX_EVIDENCE,
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string', description: '佐证会话 ID' },
                  title: { type: 'string', description: '佐证会话标题' },
                },
                required: ['sessionId', 'title'],
              },
            },
            artifactName: { type: 'string', description: 'plan 类型必填：方案文档文件名，如 阈值重构方案.html' },
            artifactHtml: { type: 'string', description: 'plan 类型必填：完整可打开的 HTML 方案文档内容' },
          },
          required: ['type', 'title', 'descriptionMarkdown', 'sourceEvidence'],
        },
      },
    },
    required: ['roundId', 'suggestions'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      const roundId = requiredText(input.roundId, 'roundId', 200)
      const noFindingReason = optionalText(input.noFindingReason, 'noFindingReason', 1000)
      const suggestions = parseSuggestions(input.suggestions)
      if (suggestions.length === 0 && !noFindingReason) throw new Error('无建议时必须填写 noFindingReason 说明原因')
      const result = await publishSuggestions(
        { projectId: context.projectId, sessionId: context.sessionId },
        { roundId, noFindingReason, suggestions },
      )
      return jsonResult({
        kind: 'advisor-suggestions-stored',
        roundId: result.roundId,
        stored: result.stored,
        noFinding: result.noFinding,
      })
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}

interface ParsedSuggestion {
  type: 'plan' | 'action'
  title: string
  descriptionMarkdown: string
  suggestedAgentId?: string | null
  agentReason?: string
  sourceEvidence: Array<{ sessionId: string; title: string }>
  artifactName?: string
  artifactHtml?: string
}

function parseSuggestions(value: unknown): ParsedSuggestion[] {
  if (!Array.isArray(value) || value.length > MAX_SUGGESTIONS) {
    throw new Error(`suggestions 必须是最多 ${MAX_SUGGESTIONS} 项的数组`)
  }
  return value.map((item, index) => {
    const record = asRecord(item)
    if (!record) throw new Error(`suggestions[${index}] 格式错误`)
    const type = record.type
    if (type !== 'plan' && type !== 'action') throw new Error(`suggestions[${index}].type 必须是 plan 或 action`)
    const sourceEvidence = parseEvidence(record.sourceEvidence, index)
    return {
      type,
      title: requiredText(record.title, `suggestions[${index}].title`, 160),
      descriptionMarkdown: requiredText(record.descriptionMarkdown, `suggestions[${index}].descriptionMarkdown`, 20_000, 400),
      suggestedAgentId: optionalText(record.suggestedAgentId, `suggestions[${index}].suggestedAgentId`, 120),
      agentReason: optionalText(record.agentReason, `suggestions[${index}].agentReason`, 1_000),
      sourceEvidence,
      artifactName: optionalText(record.artifactName, `suggestions[${index}].artifactName`, 200),
      artifactHtml: optionalText(record.artifactHtml, `suggestions[${index}].artifactHtml`, 500_000),
    }
  })
}

function parseEvidence(value: unknown, index: number): Array<{ sessionId: string; title: string }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE) {
    throw new Error(`suggestions[${index}].sourceEvidence 必须是 1~${MAX_EVIDENCE} 项的数组`)
  }
  return value.map((item, evidenceIndex) => {
    const record = asRecord(item)
    if (!record) throw new Error(`suggestions[${index}].sourceEvidence[${evidenceIndex}] 格式错误`)
    return {
      sessionId: requiredText(record.sessionId, `suggestions[${index}].sourceEvidence[${evidenceIndex}].sessionId`, 120),
      title: requiredText(record.title, `suggestions[${index}].sourceEvidence[${evidenceIndex}].title`, 200),
    }
  })
}

function requiredText(value: unknown, field: string, maxLength: number, minLength = 1): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length < minLength) throw new Error(`${field} 至少 ${minLength} 个字符，禁止提交测试或占位内容`)
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, field, maxLength)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function errorResult(error: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true }
}
