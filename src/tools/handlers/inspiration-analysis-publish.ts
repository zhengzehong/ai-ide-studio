import { publishInspirationAnalysis } from '../../core/project-inspiration.js'
import type { CreateCandidateInput } from '../../store/inspiration-notes.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

const MAX_CANDIDATES = 10
const MAX_QUESTIONS = 20

export const inspirationAnalysisPublishHandler: ToolHandler = {
  name: 'inspiration.analysis.publish',
  description: '暂存当前项目灵感的结构化整理结果。同一分析轮次可重复调用并以最后一次为准；禁止使用测试或占位内容。',
  inputSchema: {
    type: 'object',
    properties: {
      noteId: { type: 'string', description: '提示中提供的灵感 ID' },
      expectedRevision: { type: 'integer', minimum: 1, description: '提示中提供的分析版本' },
      analysisAttemptId: { type: 'string', description: '提示中提供的本轮分析 ID，必须原样传入' },
      summary: { type: 'string', minLength: 8, description: '左侧列表显示的真实结论，至少 8 个字符，禁止占位内容' },
      bodyMarkdown: { type: 'string', minLength: 80, description: '完整 Markdown 整理结果，至少 80 个字符，禁止占位内容' },
      questions: {
        type: 'array',
        maxItems: MAX_QUESTIONS,
        items: { type: 'string', description: '一个需要用户确认的问题；必须直接传字符串，不要传对象' },
      },
      candidates: {
        type: 'array',
        maxItems: MAX_CANDIDATES,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题' },
            descriptionMarkdown: { type: 'string', description: '包含背景、目标、范围、交付物和验收标准的任务说明' },
            suggestedAgentId: { type: 'string', description: '当前项目内推荐执行 Agent ID' },
            agentReason: { type: 'string', description: '推荐该 Agent 的理由' },
          },
          required: ['title', 'descriptionMarkdown'],
        },
      },
    },
    required: ['noteId', 'expectedRevision', 'analysisAttemptId', 'summary', 'bodyMarkdown', 'questions', 'candidates'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      const noteId = requiredText(input.noteId, 'noteId', 120)
      const expectedRevision = integer(input.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER)
      const analysisAttemptId = requiredText(input.analysisAttemptId, 'analysisAttemptId', 120)
      const summary = requiredText(input.summary, 'summary', 1_000, 8)
      const bodyMarkdown = requiredText(input.bodyMarkdown, 'bodyMarkdown', 50_000, 80)
      const questions = textArray(input.questions, 'questions', MAX_QUESTIONS, 500)
      const candidates = parseCandidates(input.candidates)
      const result = publishInspirationAnalysis(context, {
        noteId,
        expectedRevision,
        analysisAttemptId,
        summary,
        bodyMarkdown,
        questions,
        candidates,
      })
      return jsonResult({
        kind: 'inspiration-analysis-staged',
        staged: result.applied,
        noteId: result.note.id,
        analysisRevision: result.note.analysisRevision,
        candidateCount: candidates.length,
      })
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error))
    }
  },
}

function parseCandidates(value: unknown): CreateCandidateInput[] {
  if (!Array.isArray(value) || value.length > MAX_CANDIDATES) {
    throw new Error(`candidates 必须是最多 ${MAX_CANDIDATES} 项的数组`)
  }
  return value.map((item, index) => {
    const record = asRecord(item)
    if (!record) throw new Error(`candidates[${index}] 格式错误`)
    return {
      title: requiredText(record.title, `candidates[${index}].title`, 160),
      descriptionMarkdown: requiredText(record.descriptionMarkdown, `candidates[${index}].descriptionMarkdown`, 20_000),
      suggestedAgentId: optionalText(record.suggestedAgentId, `candidates[${index}].suggestedAgentId`, 120),
      agentReason: optionalText(record.agentReason, `candidates[${index}].agentReason`, 1_000) ?? '',
    }
  })
}

function textArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} 格式错误`)
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxLength))
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

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} 必须是 ${min}-${max} 的整数`)
  }
  return value
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
