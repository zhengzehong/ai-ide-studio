import { appendHiddenAttachmentNote, type StoredImageAttachment } from './image-attachments.js'

interface InspirationAnalysisNote {
  id: string
  title: string
  source_markdown: string
  analysis_revision: number
  analysis_attempt_id: string | null
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
    `调用示例: {"noteId":"${note.id}","expectedRevision":${note.analysis_revision},"analysisAttemptId":"${note.analysis_attempt_id ?? ''}","summary":"至少 8 个字符的真实结论","bodyMarkdown":"至少 80 个字符的完整 Markdown 分析","questions":["需要确认的问题"],"candidates":[]}`,
    `灵感 ID: ${note.id}`,
    `分析版本: ${note.analysis_revision}`,
    `本轮分析 ID: ${note.analysis_attempt_id ?? ''}`,
    `标题: ${note.title}`,
    `原始记录:\n${source}`,
    '完成分析后必须调用 inspiration.analysis.publish。noteId、expectedRevision 和 analysisAttemptId 必须与上面完全一致。',
  ].join('\n\n')
}
