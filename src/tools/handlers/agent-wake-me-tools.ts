import { ruleStore } from '../../store/rules.js'
import { getNextRunTime } from '../../core/cron.js'
import { events } from '../../core/events.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

export const agentWakeMeHandler: ToolHandler = {
  name: 'agent.wake_me',
  description: '一次性唤醒自己：到指定延迟后,系统会把 tips 注入到当前会话。基于 schedule 规则引擎实现,maxRuns=1 自动失效,不支持取消。',
  inputSchema: {
    type: 'object',
    properties: {
      delay_seconds: { type: 'number', description: '延迟秒数,最小 60(因为 cron 引擎按分钟粒度匹配)' },
      tips: { type: 'string', description: '唤醒时注入到当前会话的提示内容' },
    },
    required: ['delay_seconds', 'tips'],
  },
  async execute(input, context) {
    const delaySeconds = input.delay_seconds as number
    const tips = input.tips as string
    if (!context?.agentId || !context?.sessionId) {
      return jsonResult({ error: '当前工具上下文缺少 agentId 或 sessionId' })
    }
    if (!Number.isFinite(delaySeconds) || delaySeconds < 60) {
      return jsonResult({ error: 'delay_seconds 最小 60 秒(cron 引擎按分钟粒度匹配)' })
    }
    if (!tips || !tips.trim()) {
      return jsonResult({ error: 'tips 不能为空' })
    }

    const fireAt = new Date(Date.now() + delaySeconds * 1000)
    fireAt.setSeconds(0, 0)
    if (Date.now() + delaySeconds * 1000 > fireAt.getTime() + 60_000) {
      fireAt.setMinutes(fireAt.getMinutes() + 1)
    }
    const cron = `${fireAt.getMinutes()} ${fireAt.getHours()} ${fireAt.getDate()} ${fireAt.getMonth() + 1} *`

    const rule = ruleStore.create({
      name: `wake_me ${context.sessionId.slice(0, 12)} ${fireAt.toISOString()}`,
      cron,
      action: 'send_prompt',
      actionConfig: {
        prompt: tips.trim(),
        agent_id: context.agentId,
        session_id: context.sessionId,
        session_mode: 'existing',
      },
      enabled: true,
      projectId: context.projectId,
      maxRuns: 1,
      createdBy: `agent:${context.agentId}`,
      triggerType: 'one-shot',
    })

    const nextRun = getNextRunTime(rule.cron, new Date())
    if (nextRun) {
      ruleStore.update(rule.id, { next_run_at: nextRun.toISOString() })
      rule.next_run_at = nextRun.toISOString()
    }
    events.emit('rule:update', { ruleId: rule.id, data: { ...rule } })

    return jsonResult({
      wakeId: rule.id,
      fireAt: fireAt.toISOString(),
      tips: tips.trim(),
    })
  },
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export function _internalBuildWakeCron(fireAt: Date): string {
  return `${fireAt.getMinutes()} ${fireAt.getHours()} ${fireAt.getDate()} ${fireAt.getMonth() + 1} *`
}

export function _internalComputeFireAt(delaySeconds: number, now: Date = new Date()): Date {
  const target = new Date(now.getTime() + delaySeconds * 1000)
  const fireAt = new Date(target)
  fireAt.setSeconds(0, 0)
  if (target.getTime() > fireAt.getTime() + 60_000) {
    fireAt.setMinutes(fireAt.getMinutes() + 1)
  }
  return fireAt
}

export type { ToolHandlerInput }
