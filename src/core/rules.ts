import { ruleStore, type RuleRow } from '../store/rules.js'
import { ruleExecutionStore } from '../store/rule-executions.js'
import { taskManager, validateTaskAssignment } from './tasks.js'
import { sessionManager } from './sessions.js'
import { events } from './events.js'
import { matchCron, getNextRunTime } from './cron.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('rule-engine')

let _timer: ReturnType<typeof setInterval> | null = null
let _lastMinute = -1
const _firedThisMinute = new Set<string>()

type ActionHandler = (rule: RuleRow, now: Date) => Promise<{ taskId?: string; sessionId?: string }>

const actionHandlers: Record<string, ActionHandler> = {
  async create_task(rule, _now) {
    const config = rule.action_config
    const result = await taskManager.createTask({
      title: config.title ?? rule.name,
      description: config.description,
      source: 'schedule',
      assignAgentId: config.assign_agent_id,
      projectId: rule.project_id ?? undefined,
      sessionId: config.session_id,
      ruleId: rule.id,
      ruleName: rule.name,
      promptTemplate: config.prompt_template
        ? replaceVariables(config.prompt_template, new Date())
            .replace(/\{title\}/g, config.title ?? rule.name)
            .replace(/\{description\}/g, config.description ?? '')
        : undefined,
    })
    return { taskId: result.id }
  },

  async send_prompt(rule, _now) {
    const config = rule.action_config
    const agentId = config.agent_id
    if (!agentId) throw new Error('send_prompt action 缺少 agent_id')

    const prompt = replaceVariables(config.prompt ?? '', new Date())
    let sessionId = config.session_id

    if (sessionId) {
      validateTaskAssignment(agentId, rule.project_id, sessionId)
      try {
        await sessionManager.sendPrompt(sessionId, prompt)
      } catch {
        const session = await sessionManager.createSession(agentId, undefined, rule.project_id ?? undefined)
        sessionId = session.id
        await sessionManager.sendPrompt(session.id, prompt)
      }
    } else {
      const session = await sessionManager.createSession(agentId, undefined, rule.project_id ?? undefined)
      sessionId = session.id
      await sessionManager.sendPrompt(session.id, prompt)
    }

    return { sessionId }
  },
}

function replaceVariables(template: string, now: Date): string {
  return template
    .replace(/\{date\}/g, now.toISOString().slice(0, 10))
    .replace(/\{time\}/g, now.toTimeString().slice(0, 5))
}

async function executeRule(rule: RuleRow, now: Date): Promise<void> {
  const handler = actionHandlers[rule.action]
  if (!handler) {
    log.warn({ ruleId: rule.id, action: rule.action }, '未知的 action 类型，跳过')
    return
  }

  const nextRun = getNextRunTime(rule.cron, now)

  try {
    const result = await handler(rule, now)

    ruleStore.recordRun(rule.id, now.toISOString(), nextRun?.toISOString() ?? null)
    ruleExecutionStore.create({
      ruleId: rule.id,
      status: 'success',
      taskId: result.taskId,
      sessionId: result.sessionId,
      triggeredAt: now.toISOString(),
    })

    const updated = ruleStore.get(rule.id)
    if (updated) {
      if (updated.max_runs && updated.run_count >= updated.max_runs) {
        ruleStore.toggle(rule.id, false)
        log.info({ ruleId: rule.id, runCount: updated.run_count, maxRuns: updated.max_runs }, '规则达到最大执行次数，已自动禁用')
      }
      events.emit('rule:update', { ruleId: rule.id, data: { ...ruleStore.get(rule.id) } })
    }
  } catch (err) {
    const errorMsg = (err as Error).message
    log.error({ err, ruleId: rule.id }, '规则执行失败')

    ruleStore.recordFail(rule.id, now.toISOString(), nextRun?.toISOString() ?? null)
    ruleExecutionStore.create({
      ruleId: rule.id,
      status: 'failed',
      error: errorMsg,
      triggeredAt: now.toISOString(),
    })

    const updated = ruleStore.get(rule.id)
    if (updated) {
      events.emit('rule:update', { ruleId: rule.id, data: { ...updated } })
    }
  }
}

function tick() {
  const now = new Date()
  const currentMinute = now.getMinutes()

  if (currentMinute !== _lastMinute) {
    _lastMinute = currentMinute
    _firedThisMinute.clear()
  }

  const rules = ruleStore.list()
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (_firedThisMinute.has(rule.id)) continue
    if (!matchCron(rule.cron, now)) continue

    if (rule.max_runs && rule.run_count >= rule.max_runs) {
      ruleStore.toggle(rule.id, false)
      events.emit('rule:update', { ruleId: rule.id, data: { enabled: false, event: 'max_runs_reached' } })
      continue
    }

    _firedThisMinute.add(rule.id)
    executeRule(rule, now).catch((err) => {
      log.error({ err, ruleId: rule.id }, '规则执行未捕获异常')
    })
  }
}

export const ruleEngine = {
  start() {
    if (_timer) return
    _timer = setInterval(tick, 30_000)
    log.info({ interval: '30s' }, '规则引擎已启动')
  },

  stop() {
    if (_timer) {
      clearInterval(_timer)
      _timer = null
      log.info('规则引擎已停止')
    }
  },

  async runNow(ruleId: string): Promise<void> {
    const rule = ruleStore.get(ruleId)
    if (!rule) throw new Error(`规则不存在: ${ruleId}`)
    await executeRule(rule, new Date())
  },
}
