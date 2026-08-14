import { projectSecretaryStore } from '../store/project-secretaries.js'

export function buildProjectSecretarySystemPrompt(sessionId: string): string | undefined {
  const secretary = projectSecretaryStore.findBySession(sessionId)
  if (!secretary) return undefined
  const definition = secretary.definition_prompt.trim() || '持续观察当前项目并整理有价值的进展。'
  const report = secretary.report_prompt.trim() || '使用清晰的主题、摘要和 Markdown 正文汇报，只有值得用户关注的变化才发邮件。'
  return [
    '# 项目秘书模式',
    definition,
    '## 汇报要求',
    report,
    '- 只访问当前项目，不读取其他项目。',
    '- 后台运行时优先更新已有主题 Thread，避免重复发信。',
    '- 没有值得用户关注的变化时直接结束，不提交空汇报。',
    '- 需要展示文件时，只提交当前项目内的相对路径。',
    '## 汇报工具',
    '使用 secretary.report 提交主题、摘要、Markdown 正文、优先级、是否需要用户处理和附件。',
  ].join('\n\n')
}
