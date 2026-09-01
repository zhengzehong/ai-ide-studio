import { basename, dirname, extname, isAbsolute, normalize } from 'node:path'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { readingItemStore, type ReadingItemFormat } from '../../store/reading-items.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

const SUMMARY_BYTES = 64 * 1024

export const readingAddHandler: ToolHandler = {
  name: 'reading.add',
  description:
    '把当前会话生成的长文加入用户的阅读列表。md/html 必须传 Gateway 所在机器上的绝对文件路径；HTML 的 CSS、JS、图片须放在同目录并使用相对路径。url 只允许 HTTP 或 HTTPS。项目、会话和 Agent 由系统自动关联。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: '阅读条目标题' },
      type: { type: 'string', enum: ['md', 'html', 'url'], description: '内容类型' },
      content: { type: 'string', description: 'MD/HTML 的绝对文件路径，或 HTTP/HTTPS URL' },
    },
    required: ['title', 'type', 'content'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const title = textInput(input.title)
    const format = parseFormat(input.type)
    const content = textInput(input.content)
    if (!title) return errorResult('title 不能为空')
    if (!format) return errorResult('type 必须是 md、html 或 url')
    if (!content) return errorResult('content 不能为空')
    if (!context.sessionId) return errorResult('sessionId 缺失，reading.add 必须在会话中调用')
    if (!context.agentId) return errorResult('agentId 缺失，reading.add 必须由 Agent 调用')

    const source = resolveSource(format, content)
    if ('error' in source) return errorResult(source.error)

    const row = readingItemStore.create({
      projectId: context.projectId ?? null,
      sessionId: context.sessionId,
      agentId: context.agentId,
      title,
      summary: source.summary,
      format,
      mountPath: source.mountPath,
      entryFile: source.entryFile,
      url: source.url,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          readingId: row.id,
          title: row.title,
          format: row.format,
          status: row.status,
          createdAt: row.created_at,
        }),
      }],
    }
  },
}

type ResolvedSource = {
  mountPath: string | null
  entryFile: string | null
  url: string | null
  summary: string
} | { error: string }

function resolveSource(format: ReadingItemFormat, content: string): ResolvedSource {
  if (format === 'url') {
    let url: URL
    try {
      url = new URL(content)
    } catch {
      return { error: 'url 必须是有效的 HTTP/HTTPS 地址' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'url 只允许 HTTP/HTTPS 地址' }
    }
    return { mountPath: null, entryFile: null, url: url.toString(), summary: `${url.hostname}${url.pathname}` }
  }

  if (!isAbsolute(content)) return { error: 'content 必须是 Gateway 所在机器上的绝对路径' }
  if (!existsSync(content)) return { error: `文件不存在: ${content}` }
  const stat = statSync(content)
  if (!stat.isFile()) return { error: 'content 必须指向一个文件' }
  const extension = extname(content).toLowerCase()
  if (format === 'md' && extension !== '.md') return { error: 'Markdown 阅读条目必须使用 .md 文件' }
  if (format === 'html' && extension !== '.html' && extension !== '.htm') {
    return { error: 'HTML 阅读条目必须使用 .html 或 .htm 文件' }
  }
  const normalized = normalize(content)
  return {
    mountPath: normalize(dirname(normalized)),
    entryFile: basename(normalized),
    url: null,
    summary: summarizeFile(normalized, format),
  }
}

function summarizeFile(filePath: string, format: 'md' | 'html'): string {
  const descriptor = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(SUMMARY_BYTES)
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
    const source = buffer.subarray(0, bytesRead).toString('utf8')
    const readable = format === 'html'
      ? source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      : source.replace(/^\s{0,3}#{1,6}\s+/gm, '').replaceAll('[', ' ').replaceAll(']', ' ').replace(/[-`*_>()!]/g, ' ')
    return readable.replace(/\s+/g, ' ').trim().slice(0, 180)
  } finally {
    closeSync(descriptor)
  }
}

function parseFormat(value: unknown): ReadingItemFormat | null {
  return value === 'md' || value === 'html' || value === 'url' ? value : null
}

function textInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
}
