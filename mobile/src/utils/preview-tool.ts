// 工具调用 title 匹配辅助。
// preview.publish 通过 stdio gateway 调用时 title = 'preview.publish'，
// 通过 ai-ide-tools HTTP MCP server 调用时 title = 'mcp__ai-ide-tools__preview_publish'，
// 两种格式都要识别为 preview.publish 工具，前端才能渲染 PreviewCard。
export function isPreviewPublishTool(title: string | undefined | null): boolean {
  if (!title) return false
  return title === 'preview.publish' || title === 'mcp__ai-ide-tools__preview_publish'
}
