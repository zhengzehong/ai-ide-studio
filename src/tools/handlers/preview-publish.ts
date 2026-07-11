import { dirname, isAbsolute, join, basename, normalize } from 'path'
import { existsSync, statSync } from 'fs'
import { previewStore } from '../../store/previews.js'
import { loadConfig } from '../../core/config.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

export const previewPublishHandler: ToolHandler = {
  name: 'preview.publish',
  description:
    '发布原型预览。把指定目录或 HTML 文件发布为可访问的预览 URL。调用后前端对话流会自动渲染预览卡片,用户点击全屏查看。返回 {previewId, url, title, target, taskId, createdAt}。',
  inputSchema: {
    type: 'object',
    properties: {
      sourcePath: { type: 'string', description: '原型根目录或 HTML 文件的绝对路径' },
      title: { type: 'string', description: '预览标题,默认取目录名/文件名' },
      target: { type: 'string', enum: ['pc', 'app'], description: '目标端:pc(宽屏)或 app(手机),默认 pc' },
      entryFile: { type: 'string', description: 'sourcePath 为目录时的入口文件,默认 index.html' },
      taskId: { type: 'string', description: '关联任务 ID(选填)' },
      description: { type: 'string', description: '预览描述(选填)' },
    },
    required: ['sourcePath'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const sourcePath = requireString(input, 'sourcePath')
    if (!isAbsolute(sourcePath)) {
      return errorResult('sourcePath 必须是绝对路径')
    }
    if (!existsSync(sourcePath)) {
      return errorResult(`sourcePath 不存在: ${sourcePath}`)
    }

    const stat = statSync(sourcePath)
    let resolvedSourcePath: string
    let entryFile: string
    if (stat.isFile()) {
      resolvedSourcePath = normalize(dirname(sourcePath))
      entryFile = basename(sourcePath)
    } else if (stat.isDirectory()) {
      resolvedSourcePath = normalize(sourcePath)
      const entryInput = optionalString(input, 'entryFile')
      entryFile = entryInput && entryInput.trim() ? entryInput.trim() : 'index.html'
    } else {
      return errorResult('sourcePath 既不是文件也不是目录')
    }

    const entryFullPath = join(resolvedSourcePath, entryFile)
    if (!existsSync(entryFullPath) || !statSync(entryFullPath).isFile()) {
      return errorResult(`入口文件不存在: ${entryFile}`)
    }

    const projectId = context.projectId ?? optionalString(input, 'projectId')
    if (!projectId) {
      return errorResult('projectId is required (set in context or pass explicitly)')
    }

    const target = parseTarget(input.target)
    const title = optionalString(input, 'title') ?? basename(resolvedSourcePath)
    const taskId = optionalString(input, 'taskId') ?? null
    const description = optionalString(input, 'description') ?? null

    const row = previewStore.create({
      projectId,
      title,
      sourcePath: resolvedSourcePath,
      entryFile,
      target,
      taskId,
      description,
      createdByAgentId: context.agentId ?? null,
    })

    const config = loadConfig()
    const token = config.localToken ? `?token=${encodeURIComponent(config.localToken)}` : ''
    const url = `/preview/${row.id}/${token}`

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            previewId: row.id,
            url,
            title: row.title,
            target: row.target,
            taskId: row.task_id,
            createdAt: row.created_at,
          }),
        },
      ],
    }
  },
}

function parseTarget(value: unknown): 'pc' | 'app' {
  return value === 'app' ? 'app' : 'pc'
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 不能为空`)
  return value.trim()
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorResult(message: string): ToolHandlerResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  }
}
