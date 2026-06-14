import type { AgentRow } from '../store/agents.js'
import type { AgentSessionMessageRow, AgentSessionWatchRow } from '../store/agent-session-communication.js'

interface MessagePromptInput {
  message: AgentSessionMessageRow
  sourceAgent: AgentRow
  targetSessionId: string
}

interface WatchPromptInput {
  watch: AgentSessionWatchRow
  watchedAgent: AgentRow
  messageId?: string
}

export function buildAgentSessionMessagePrompt(input: MessagePromptInput): string {
  const { message, sourceAgent, targetSessionId } = input
  const relatedInfo = prettyJson(message.related_info_json)
  if (message.need_reply === 1) {
    return `[系统消息] 你收到了一条来自 AI IDE Studio 中其他 Agent 的消息，并且这条消息需要你回复。

来源 Agent：${sourceAgent.name}（${sourceAgent.id}）
来源会话：${message.source_session_id}
目标会话：${targetSessionId}
平台消息 ID：${message.id}

关联信息 JSON：
${relatedInfo}

消息内容：
${message.content}

执行要求：
1. 先处理上面的消息内容。
2. 完成后必须调用 agent.message.send 回复来源会话。
3. 回复时 targetSessionId 必须使用 "${message.source_session_id}"。
4. 回复时 relatedInfo 建议沿用上面的关联信息 JSON。
5. 不要只在最终回答里说明结果；必须通过 agent.message.send 把结果发回来源会话。`
  }

  return `[系统消息] 你收到了一条来自 AI IDE Studio 中其他 Agent 的消息。

来源 Agent：${sourceAgent.name}（${sourceAgent.id}）
来源会话：${message.source_session_id}
目标会话：${targetSessionId}

关联信息 JSON：
${relatedInfo}

消息内容：
${message.content}

请根据这条消息继续你的工作。
如果需要查看来源会话或相关上下文，可以使用 agent.session.messages 查询对应 session 的最近消息。`
}

export function buildAgentSessionReplyReminderPrompt(input: MessagePromptInput): string {
  const { message, sourceAgent, targetSessionId } = input
  return `[系统提醒] 你刚才收到的一条 Agent 消息要求回复，但系统还没有检测到你调用 agent.message.send 回传结果。

来源 Agent：${sourceAgent.name}（${sourceAgent.id}）
来源会话：${message.source_session_id}
当前会话：${targetSessionId}
平台消息 ID：${message.id}

关联信息 JSON：
${prettyJson(message.related_info_json)}

原消息内容：
${message.content}

请现在调用 agent.message.send 回复来源会话。
调用要求：
- targetSessionId 必须使用 "${message.source_session_id}"。
- content 写清楚你的处理结果、结论、阻塞原因或需要对方继续的信息。
- relatedInfo 建议沿用上面的关联信息 JSON。`
}

export function buildAgentSessionWatchPrompt(input: WatchPromptInput): string {
  const { watch, watchedAgent, messageId } = input
  return `[系统消息] 你监听的 Agent 会话已经完成一轮执行。

被监听 Agent：${watchedAgent.name}（${watchedAgent.id}）
被监听会话：${watch.watched_session_id}
你的会话：${watch.watcher_session_id}
Watch ID：${watch.id}
触发消息 ID：${messageId ?? 'unknown'}

关联信息 JSON：
${prettyJson(watch.related_info_json)}

你可以调用 agent.session.messages 查看被监听会话的最近消息：
sessionId = "${watch.watched_session_id}"

请根据该会话的最新结果决定是否继续处理。`
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2)
  } catch {
    return '{}'
  }
}
