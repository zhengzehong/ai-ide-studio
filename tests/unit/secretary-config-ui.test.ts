import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { SecretaryConfigModal } from '../../ui/src/pages/secretary/SecretaryConfigModal'
import { SecretaryConfigSheet } from '../../mobile/src/components/SecretaryConfigSheet'
import type { SecretaryData } from '../../ui/src/stores/secretary.store'
import type { AgentData } from '../../ui/src/stores/agent.store'
import type { MobileSecretary } from '../../mobile/src/stores/secretary.store'

const secretary: SecretaryData = {
  id: 'secretary-1', projectId: 'project-1', name: '研发秘书', definitionPrompt: '关注研发', reportPrompt: '汇报风险',
  executionAgentId: 'agent-1', runtimeSessionId: 'runtime-1', chatSessionId: 'chat-1', enabled: true,
  observeAll: false, observedAgentIds: ['agent-1'],
  triggers: [{ id: 'trigger-1', type: 'session_done', cron: null, enabled: true }],
  lastRunAt: null, lastError: null, unreadCount: 0, createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
}
const agent: AgentData = {
  id: 'agent-1', name: '产品经理', type: 'pm', runtime: 'mock', status: 'idle', permission_level: 1,
  config_json: null, created_at: '2026-08-17T00:00:00.000Z', project_id: 'project-1',
}
const mobileSecretary: MobileSecretary = {
  id: secretary.id, projectId: secretary.projectId, name: secretary.name,
  definitionPrompt: secretary.definitionPrompt, reportPrompt: secretary.reportPrompt,
  executionAgentId: secretary.executionAgentId, chatSessionId: secretary.chatSessionId,
  enabled: secretary.enabled, observeAll: secretary.observeAll, observedAgentIds: secretary.observedAgentIds,
  triggers: secretary.triggers, lastRunAt: secretary.lastRunAt, lastError: secretary.lastError, unreadCount: secretary.unreadCount,
}

describe('secretary configuration UI', () => {
  test('renders complete PC edit controls', () => {
    const html = renderToStaticMarkup(createElement(SecretaryConfigModal, {
      secretary,
      agents: [agent],
      saving: false,
      onSave: async () => {},
      onClose: () => {},
    }))
    expect(html).toContain('编辑项目秘书')
    expect(html).toContain('指定 Agent')
    expect(html).toContain('Task 需要处理时检查')
    expect(html).toContain('定时检查')
    expect(html).toContain('已启用')
  })

  test('renders matching APP edit controls', () => {
    const html = renderToStaticMarkup(createElement(SecretaryConfigSheet, {
      secretary: mobileSecretary,
      agents: [{ id: 'agent-1', name: '产品经理', type: 'pm' }],
      saving: false,
      onSave: async () => {},
      onClose: () => {},
    }))
    expect(html).toContain('编辑项目秘书')
    expect(html).toContain('指定 Agent')
    expect(html).toContain('Task 需要处理时检查')
    expect(html).toContain('定时检查')
    expect(html).toContain('启用状态')
  })
})
