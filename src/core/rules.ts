import { ruleStore } from '../store/rules.js'
import { taskManager } from './tasks.js'
import { events } from './events.js'
import { matchCron, getNextRunTime } from './cron.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('rule-engine')

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
        log.error({ err, ruleId: rule.id }, '规则执行失败')
      })
    } catch (err) {
      log.error({ err, ruleId: rule.id }, '规则执行异常')
    }
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
}
