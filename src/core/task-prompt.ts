import { taskExecutionModeStore, type TaskExecutionModeRow } from '../store/task-execution-modes.js'

export function getTaskMode(modeId: string | null | undefined): TaskExecutionModeRow | null {
  if (!modeId) return null
  return taskExecutionModeStore.get(modeId) ?? null
}

export function buildTaskPrompt(
  task: { id: string; title: string; description?: string | null; source: string },
  opts?: { sessionReuse?: boolean; ruleName?: string; mode?: TaskExecutionModeRow | null },
): string {
  const parts: string[] = []

  if (opts?.sessionReuse) {
    parts.push('[接续上下文] 以下是一个新的任务指派，请在当前对话上下文基础上执行。\n')
  }

  parts.push(`[系统提示] 这是一条由 AI IDE Studio 任务系统触发的对话。
你被分派了一个项目任务，请按照以下信息执行。

━━━ 任务信息 ━━━
任务 ID：${task.id}
任务标题：${task.title}
任务描述：${task.description || '（无）'}
来源：${task.source}（human=用户创建 / schedule=定时触发 / agent=其他Agent创建）`)

  if (opts?.ruleName) {
    parts.push(`定时规则：${opts.ruleName}`)
  }

  if (opts?.mode) {
    parts.push(`
━━━ 执行模式 ━━━
当前任务采用「${opts.mode.name}」执行模式
${opts.mode.description ? opts.mode.description : ''}
${opts.mode.prompt_template ? `\n${opts.mode.prompt_template}` : ''}`)
  }

  const reportTemplate =
    opts?.mode?.report_template ||
    `## 本轮工作
- 完成了什么
## 下一步计划
- 接下来要做什么
## 问题/总结
- blocked 时写需要确认的问题；done 时写完成总结`

  parts.push(`
━━━ 任务管理工具 ━━━
本次对话中你可以使用以下 AI IDE Studio 平台工具来管理任务进度。
注意：这些是平台级的项目任务管理工具，不是你自身的内部 task/todo，请区分使用。

1. studio.task.update_progress(taskId, stage)
   - 用途：轻量汇报当前阶段（一句话），更新看板卡片显示
   - 时机：每完成一个小步骤、开始新的阶段时调用
   - 参数：stage 是一句话描述，如 "正在分析代码结构"
   - 示例：studio.task.update_progress("${task.id}", "正在分析代码结构")
   - 特殊：如果任务处于「待确认」状态，调用此工具会自动恢复为「行动中」

2. studio.task.report(taskId, agentStatus, reportMd?, stage?)
   - 用途：关键节点汇报，带 Markdown 报告，并更新你的自我评估状态
   - 参数：
     * agentStatus（必填）：你当前的状态，三选一
       - milestone：中间步骤完成，汇报阶段性成果（任务状态保持/恢复为「行动中」，Agent 继续工作）
       - blocked：遇到问题需要人工决策（任务状态变为「待确认」）
       - done：本轮工作已完成，等待人工验收（任务状态变为「待确认」）
     * reportMd（建议填）：Markdown 报告，按当前执行模式要求填写，参考模板：
${reportTemplate
  .split('\n')
  .map((line) => `       ${line}`)
  .join('\n')}
     * stage（可选）：一句话阶段描述
   - 示例：
     studio.task.report("${task.id}", "milestone", "## 根因分析\\n- 问题根因是 XXX\\n## 修复方案\\n- 计划修改 YYY", "已完成根因分析")
     studio.task.report("${task.id}", "blocked", "## 需要确认\\n- Token 过期策略选黑名单还是滑动续期？")
     studio.task.report("${task.id}", "done", "## 完成总结\\n- 登录模块已重构为 JWT 方案，涉及 5 个文件")

━━━ 执行要求 ━━━
1. 开始工作前，先调用 studio.task.update_progress 标记 "开始执行"
2. 执行过程中，每完成一个关键步骤都调用 studio.task.update_progress 更新阶段
3. 完成中间步骤（如根因分析、规划完成、阶段性成果）时，调用 studio.task.report(agentStatus="milestone") 汇报阶段性成果，Agent 继续工作
4. 遇到需要决策的问题或无法解决的障碍，调用 studio.task.report(agentStatus="blocked") 并附上问题
5. 本轮工作完成后，调用 studio.task.report(agentStatus="done") 并附上完成总结
6. 被人工回复后，你会收到 [人工回复] 消息，继续执行，完成后再次 report
7. 不要在没有 report(agentStatus="done") 的情况下就结束对话

请现在开始执行任务。`)

  return parts.join('\n')
}
