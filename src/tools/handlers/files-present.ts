import { randomUUID } from 'node:crypto'
import { inspectFile } from '../../core/filesystem.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

const MAX_FILES = 20

export const filesPresentHandler: ToolHandler = {
  name: 'files.present',
  description: '向用户展示一个或多个项目交付文件。文件内容不会进入工具结果，用户点击卡片后按需读取。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '交付内容标题，默认“本次交付”' },
      files: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FILES,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '工作空间相对路径或服务端可读绝对路径' },
            title: { type: 'string', description: '文件展示标题，默认使用文件名' },
          },
          required: ['path'],
        },
      },
    },
    required: ['files'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    if (!context.projectId || !context.workDir) return errorResult('files.present 需要项目和工作目录上下文')
    if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > MAX_FILES) {
      return errorResult(`files 必须包含 1-${MAX_FILES} 个文件`)
    }

    const seen = new Set<string>()
    const files = []
    for (const item of input.files) {
      const record = asRecord(item)
      const path = text(record?.path)
      if (!path) return errorResult('每个文件都必须提供 path')
      const key = path.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) return errorResult(`文件路径重复: ${path}`)
      seen.add(key)
      const metadata = inspectFile(context.workDir, path)
      if (!metadata) return errorResult(`文件不存在、不可读取或不在项目目录内: ${path}`)
      files.push({
        ...metadata,
        title: text(record?.title) ?? metadata.name,
      })
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          kind: 'files',
          presentationId: `files-${randomUUID()}`,
          projectId: context.projectId,
          title: text(input.title) ?? '本次交付',
          files,
          createdAt: new Date().toISOString(),
        }),
      }],
    }
  },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function errorResult(error: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error }) }], isError: true }
}
