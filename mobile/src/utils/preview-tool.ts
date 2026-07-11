// 工具调用 title 匹配辅助。
// preview.publish 通过 stdio gateway 调用时 title = 'preview.publish'，
// 通过 ai-ide-tools HTTP MCP server 调用时 title = 'mcp__ai-ide-tools__preview_publish'，
// 两种格式都要识别为 preview.publish 工具，前端才能渲染 PreviewCard。
export function isPreviewPublishTool(title: string | undefined | null): boolean {
  if (!title) return false
  return title === 'preview.publish' || title === 'mcp__ai-ide-tools__preview_publish'
}

export interface PreviewPublishOutput {
  previewId: string
  title: string
  target: 'pc' | 'app'
  taskId?: string | null
  createdAt: string
}

// 解析 preview.publish 工具的 rawOutput。支持三种形态:
// 1. MCP 标准 content 数组: [{type:'text', text:'<JSON string>'}] —— ai-ide-tools HTTP MCP 走这个
// 2. JSON 字符串: '<JSON>' —— stdio gateway 偶尔会 stringify
// 3. 直接对象: {previewId, title, target, taskId, createdAt}
// 任何一种解析失败、或对象缺关键字段、或带 error 字段,都返回 null。
export function parsePreviewPublishOutput(raw: unknown): PreviewPublishOutput | null {
  const obj = unwrapRawOutput(raw)
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  if (rec.error !== undefined) return null
  const previewId = typeof rec.previewId === 'string' ? rec.previewId : null
  const title = typeof rec.title === 'string' ? rec.title : null
  const createdAt = typeof rec.createdAt === 'string' ? rec.createdAt : null
  const target = rec.target === 'pc' ? 'pc' : rec.target === 'app' ? 'app' : null
  if (!previewId || !title || !createdAt || !target) return null
  const taskId = typeof rec.taskId === 'string' ? rec.taskId : null
  return { previewId, title, target, taskId, createdAt }
}

function unwrapRawOutput(raw: unknown): unknown {
  if (raw == null) return null
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        if (rec.type === 'text' && typeof rec.text === 'string') {
          try { return JSON.parse(rec.text) } catch { continue }
        }
      }
    }
    return null
  }
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw
}
