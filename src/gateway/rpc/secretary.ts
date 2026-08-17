import {
  archiveSecretaryThread,
  createProjectSecretary,
  deleteProjectSecretary,
  getProjectSecretary,
  getSecretaryThread,
  listProjectSecretaries,
  listSecretaryThreads,
  markSecretaryThreadRead,
  runProjectSecretaryNow,
  sendSecretaryChat,
  updateProjectSecretary,
} from '../../core/project-secretary.js'
import type { RpcHandlerMap } from './types.js'

export const secretaryRpcHandlers: RpcHandlerMap = {
  'secretary.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(listProjectSecretaries(requiredText(msg.projectId, 'projectId')))
  },

  'secretary.get'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(getProjectSecretary(requiredText(msg.secretaryId, 'secretaryId'), requiredText(msg.projectId, 'projectId')))
  },

  async 'secretary.create'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const result = await createProjectSecretary({
      projectId,
      name: requiredText(msg.name, 'name', 120),
      definitionPrompt: optionalText(msg.definitionPrompt, 20_000) ?? '',
      reportPrompt: optionalText(msg.reportPrompt, 20_000) ?? '',
      executionAgentId: requiredText(msg.executionAgentId, 'executionAgentId'),
      observedAgentIds: optionalStringArray(msg.observedAgentIds, 'observedAgentIds', 100, 120),
      observeAll: msg.observeAll === true,
      cron: optionalText(msg.cron, 80),
      watchSessionDone: msg.watchSessionDone !== false,
      watchTaskNeedsInput: msg.watchTaskNeedsInput === true,
    })
    sendResult(result)
  },

  async 'secretary.update'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const result = await updateProjectSecretary(requiredText(msg.secretaryId, 'secretaryId'), requiredText(msg.projectId, 'projectId'), {
      name: msg.name === undefined ? undefined : requiredText(msg.name, 'name', 120),
      definitionPrompt: optionalText(msg.definitionPrompt, 20_000),
      reportPrompt: optionalText(msg.reportPrompt, 20_000),
      executionAgentId: optionalText(msg.executionAgentId, 120),
      enabled: typeof msg.enabled === 'boolean' ? msg.enabled : undefined,
      observeAll: typeof msg.observeAll === 'boolean' ? msg.observeAll : undefined,
      observedAgentIds: msg.observedAgentIds === undefined ? undefined : optionalStringArray(msg.observedAgentIds, 'observedAgentIds', 100, 120),
      cron: Object.prototype.hasOwnProperty.call(msg, 'cron') ? optionalText(msg.cron, 80) : undefined,
      watchSessionDone: typeof msg.watchSessionDone === 'boolean' ? msg.watchSessionDone : undefined,
      watchTaskNeedsInput: typeof msg.watchTaskNeedsInput === 'boolean' ? msg.watchTaskNeedsInput : undefined,
    })
    sendResult(result)
  },

  'secretary.delete'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const secretaryId = requiredText(msg.secretaryId, 'secretaryId')
    deleteProjectSecretary(secretaryId, projectId)
    sendResult({ deleted: true, secretaryId })
  },

  'secretary.runNow'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const secretaryId = requiredText(msg.secretaryId, 'secretaryId')
    const run = runProjectSecretaryNow(secretaryId, projectId)
    sendResult({ accepted: true, runId: run.id })
  },

  'secretary.threads.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(listSecretaryThreads(requiredText(msg.secretaryId, 'secretaryId'), requiredText(msg.projectId, 'projectId'), msg.unreadOnly === true))
  },

  'secretary.thread.get'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(getSecretaryThread(requiredText(msg.secretaryId, 'secretaryId'), requiredText(msg.projectId, 'projectId'), requiredText(msg.threadId, 'threadId')))
  },

  'secretary.thread.markRead'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(markSecretaryThreadRead(requiredText(msg.secretaryId, 'secretaryId'), requiredText(msg.projectId, 'projectId'), requiredText(msg.threadId, 'threadId')))
  },

  'secretary.thread.archive'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(archiveSecretaryThread(requiredText(msg.secretaryId, 'secretaryId'), requiredText(msg.projectId, 'projectId'), requiredText(msg.threadId, 'threadId')))
  },

  async 'secretary.chat.send'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const projectId = requiredText(msg.projectId, 'projectId')
    const result = await sendSecretaryChat(requiredText(msg.secretaryId, 'secretaryId'), projectId, requiredText(msg.content, 'content', 20_000))
    state.subscriptions.add(result.sessionId)
    sendResult(result)
  },
}

function requireOwner(authMode: 'owner' | 'guest'): void {
  if (authMode !== 'owner') throw new Error('访客无权访问项目秘书')
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`文本最多 ${maxLength} 个字符`)
  return value.trim()
}

function optionalStringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} 格式错误`)
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxLength))
}
