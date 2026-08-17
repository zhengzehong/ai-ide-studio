import { createChildLogger } from './logger.js'
import { projectSecretaryStore, type SecretaryTriggerType } from '../store/project-secretaries.js'
import { ruleStore } from '../store/rules.js'

const log = createChildLogger('project-secretary-triggers')

export interface SecretaryTriggerConfiguration {
  cron?: string
  watchSessionDone?: boolean
  watchTaskNeedsInput?: boolean
}

export function configureSecretaryTriggers(
  secretaryId: string,
  projectId: string,
  input: SecretaryTriggerConfiguration,
): void {
  if (input.cron?.trim()) createCronTrigger(secretaryId, projectId, input.cron.trim())
  if (input.watchSessionDone !== false) {
    projectSecretaryStore.createTrigger({
      secretaryId,
      type: 'session_done',
      eventType: 'session:committed_done',
    })
  }
  if (input.watchTaskNeedsInput) {
    projectSecretaryStore.createTrigger({
      secretaryId,
      type: 'task_needs_input',
      eventType: 'task:update',
    })
  }
}

export function reconfigureSecretaryCron(secretaryId: string, projectId: string, cron: string): void {
  deleteSecretaryRules(secretaryId, projectId)
  projectSecretaryStore.deleteTriggersByType(secretaryId, 'cron')
  if (cron.trim()) createCronTrigger(secretaryId, projectId, cron.trim())
}

export function reconfigureSecretaryEventTrigger(
  secretaryId: string,
  type: Exclude<SecretaryTriggerType, 'cron'>,
  eventType: string,
  enabled: boolean,
): void {
  projectSecretaryStore.deleteTriggersByType(secretaryId, type)
  if (enabled) projectSecretaryStore.createTrigger({ secretaryId, type, eventType })
}

export function deleteSecretaryRules(secretaryId: string, projectId: string): void {
  for (const rule of ruleStore.list(projectId)) {
    if (rule.action === 'secretary_tick' && rule.action_config.secretary_id === secretaryId) {
      ruleStore.delete(rule.id)
    }
  }
}

export function setSecretaryRulesEnabled(secretaryId: string, projectId: string, enabled: boolean): void {
  for (const rule of ruleStore.list(projectId)) {
    if (rule.action !== 'secretary_tick' || rule.action_config.secretary_id !== secretaryId) continue
    if (rule.enabled !== enabled) ruleStore.toggle(rule.id, enabled)
  }
  log.debug({ secretaryId, projectId, enabled }, '秘书定时规则启用状态已同步')
}

function createCronTrigger(secretaryId: string, projectId: string, cron: string): void {
  const secretary = projectSecretaryStore.get(secretaryId)
  if (!secretary) return
  const trigger = projectSecretaryStore.createTrigger({ secretaryId, type: 'cron', cron })
  ruleStore.create({
    name: `${secretary.name} 定时汇报`,
    description: '项目秘书定时检查',
    cron,
    action: 'secretary_tick',
    actionConfig: { secretary_id: secretaryId, trigger_id: trigger.id },
    enabled: secretary.enabled === 1,
    projectId,
    createdBy: `secretary:${secretaryId}`,
  })
  log.debug({ secretaryId, projectId, triggerId: trigger.id, cron }, '秘书定时触发已配置')
}
