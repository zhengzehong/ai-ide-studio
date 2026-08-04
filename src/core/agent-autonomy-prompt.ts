import { agentStore } from '../store/agents.js'
import { getAgentAutonomyConfig } from './agent-autonomy-config.js'

export function buildAgentAutonomySystemPrompt(agentId: string): string {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  const autonomy = getAgentAutonomyConfig(agentId)
  if (!autonomy.memoryPath) throw new Error(`Agent 自主记忆路径尚未初始化: ${agentId}`)
  const independentPrompt = autonomy.prompt.trim()
  return [
    '# 自主运行模式',
    independentPrompt || '根据用户关注点和当前排班，自主推进最有价值的工作。',
    '## 工作记忆',
    `工作记忆文件绝对路径: ${autonomy.memoryPath}`,
    '- 每轮自主工作开始前读取这个文件。',
    '- 取得有意义进展后更新文件。',
    '- 可以追加、覆写、去重和重组内容。',
    '- 只记录当前状态、完成事项、关键结论和下一步，不保存凭据。',
    '- 文件过长时主动压缩整理。',
    '## 运行规则',
    '- 自主检查和用户对本自主会话的控制指令不创建平台 Task、子任务或其他 Session，只在当前固定自主 Session 内推进。',
    '- 使用 studio.autonomy.plan.update 维护当天排班。',
    '- 只有出现值得用户关注的新结论时才调用 studio.autonomy.report。',
    '- 没有值得推进的工作时直接结束，不提交空汇报。',
  ].join('\n\n')
}
