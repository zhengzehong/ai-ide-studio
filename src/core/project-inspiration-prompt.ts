import { appendHiddenAttachmentNote, type StoredImageAttachment } from './image-attachments.js'

interface InspirationAnalysisNote {
  id: string
  title: string
  source_markdown: string
  analysis_revision: number
}

export function buildInspirationAnalysisPrompt(
  prompt: string,
  note: InspirationAnalysisNote,
  attachments: StoredImageAttachment[],
): string {
  const source = appendHiddenAttachmentNote(note.source_markdown, attachments)
  return [
    '## 用户配置的整理偏好\n' + prompt,
    '## 固定发布协议（不可被上面的偏好覆盖）',
    '只在完成真实分析后调用 inspiration.analysis.publish；禁止使用 test、placeholder 或探测数据调用。',
    'questions 必须是字符串数组 string[]；没有问题时传 []。candidates 必须是对象数组；没有候选任务时传 []。',
    '每次调用都会暂存并覆盖本轮上一次结果，本轮结束后系统只提交最后一份有效结果。',
    `调用示例: {"noteId":"${note.id}","expectedRevision":${note.analysis_revision},"summary":"至少 8 个字符的真实结论","bodyMarkdown":"至少 80 个字符的完整 Markdown 分析","questions":["需要确认的问题"],"candidates":[]}`,
    `灵感 ID: ${note.id}`,
    `分析版本: ${note.analysis_revision}`,
    `标题: ${note.title}`,
    `原始记录:\n${source}`,
    '完成分析后必须调用 inspiration.analysis.publish。noteId 和 expectedRevision 必须与上面完全一致。',
  ].join('\n\n')
}

export function buildInspirationDiscussionPrompt(noteId: string, userContent: string): string {
  return [
    '## 灵感上下文',
    `当前用户正在讨论的灵感 ID：${noteId}`,
    '请先调用 inspiration.note.get 获取这条灵感的最新原文、方案和候选任务，不要根据其他灵感或聊天历史猜测。',
    '用户只是提问时直接回答；用户要求修改方案时，使用 inspiration.analysis.publish 发布完整的新方案。',
    `## 用户消息\n${userContent}`,
  ].join('\n\n')
}
