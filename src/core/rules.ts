import { ruleStore } from '../store/rules.js'
import { taskManager } from './tasks.js'
import { events } from './events.js'
import { matchCron, getNextRunTime } from './cron.js'

let _timer: ReturnType<typeof setInterval> | null = null
let _lastMinute = -1
const _firedThisMinute = new Set<string>()

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

    _firedThisMinute.add(rule.id)

    try {
      taskManager.createTask({
        title: rule.action_config.title,
        description: rule.action_config.description,
        source: 'schedule',
        assignAgentId: rule.action_config.assign_agent_id,
      }).then(() => {
        const nextRun = getNextRunTime(rule.cron, new Date())
        ruleStore.recordRun(rule.id, now.toISOString(), nextRun?.toISOString() ?? null)

        const updated = ruleStore.get(rule.id)
        if (updated) {
          events.emit('rule:update', { ruleId: rule.id, data: { ...updated } })
        }
      }).catch((err) => {
        console.error(`[RuleEngine] 规则 ${rule.id} 执行失败:`, err)
      })
    } catch (err) {
      console.error(`[RuleEngine] 规则 ${rule.id} 执行异常:`, err)
    }
  }
}

export const ruleEngine = {
  start() {
    if (_timer) return
    _timer = setInterval(tick, 30_000)
    console.log('[RuleEngine] 规则引擎已启动 (30s 间隔)')
  },

  stop() {
    if (_timer) {
      clearInterval(_timer)
      _timer = null
      console.log('[RuleEngine] 规则引擎已停止')
    }
  },
}
