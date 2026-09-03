import {
  acceptSuggestion,
  configureAdvisor,
  getAdvisorWorkspace,
  ignoreSuggestion,
  listAdvisorSuggestionsFor,
  markAdvisorSuggestionsViewed,
  rebuildAdvisorSession,
} from '../../core/project-advisor.js'
import type { RpcHandlerMap } from './types.js'

export const advisorRpcHandlers: RpcHandlerMap = {
  'advisor.get'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(getAdvisorWorkspace(requiredText(msg.projectId, 'projectId')))
  },

  async 'advisor.configure'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await configureAdvisor(requiredText(msg.projectId, 'projectId'), {
      advisorAgentId: requiredText(msg.advisorAgentId, 'advisorAgentId'),
      advisorPrompt: optionalText(msg.advisorPrompt, 20_000),
      minSilenceMinutes: optionalNumber(msg.minSilenceMinutes, 'minSilenceMinutes'),
      enabled: optionalBoolean(msg.enabled, 'enabled'),
    }))
  },

  async 'advisor.session.rebuild'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await rebuildAdvisorSession(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.advisorAgentId, 'advisorAgentId'),
    ))
  },

  'advisor.suggestion.list'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult({ suggestions: listAdvisorSuggestionsFor(requiredText(msg.projectId, 'projectId')) })
  },

  async 'advisor.suggestion.accept'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult(await acceptSuggestion(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.suggestionId, 'suggestionId'),
      {
        agentId: optionalText(msg.agentId, 120),
        sessionId: optionalText(msg.sessionId, 120),
        sessionMode: optionalSessionMode(msg.sessionMode),
        execute: requiredBoolean(msg.execute, 'execute'),
      },
    ))
  },

  'advisor.suggestion.ignore'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    sendResult({ suggestions: ignoreSuggestion(
      requiredText(msg.projectId, 'projectId'),
      requiredText(msg.suggestionId, 'suggestionId'),
    ) })
  },

  'advisor.suggestion.markRead'(msg, { sendResult, state }) {
    requireOwner(state.authMode)
    const ids = Array.isArray(msg.ids)
      ? msg.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : null
    sendResult({ marked: markAdvisorSuggestionsViewed(requiredText(msg.projectId, 'projectId'), ids) })
  },
}

function requireOwner(authMode: 'owner' | 'guest'): void {
  if (authMode !== 'owner') throw new Error('访客无权访问项目参谋')
}

function requiredText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  const text = value.trim()
  if (text.length > maxLength) throw new Error(`${field} 最多 ${maxLength} 个字符`)
  return text
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new Error(`文本最多 ${maxLength} 个字符`)
  return value.trim()
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${field} 必须是非负数字`)
  return Math.floor(value)
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} 不能为空`)
  return value
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  return value === undefined ? undefined : requiredBoolean(value, field)
}

function optionalSessionMode(value: unknown): 'existing' | 'new_each' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'existing' || value === 'new_each') return value
  throw new Error('sessionMode 必须是 existing 或 new_each')
}
