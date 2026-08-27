import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { AgentSettingsModal } from '../../ui/src/components/agent/AgentSettingsModal.tsx'
import { AgentSystemPromptEditorModal } from '../../ui/src/components/agent/AgentSystemPromptEditorModal.tsx'
import * as settingsUpdate from '../../ui/src/components/agent/agent-settings-update.ts'
import type { AgentData } from '../../ui/src/stores/agent.store.ts'

const agent: AgentData = {
  id: 'agent-existing',
  name: '代码工程师',
  type: 'developer',
  runtime: 'codex',
  status: 'idle',
  permission_level: 3,
  config_json: null,
  created_at: '2026-08-27T00:00:00.000Z',
  project_id: 'project-1',
  system_prompt: '只修改当前需求范围内的代码。',
  icon: 'bot',
  avatar_url: null,
}

describe('PC existing Agent system prompt settings', () => {
  test('shows a compact prompt summary instead of the long editor', () => {
    const html = renderToStaticMarkup(createElement(AgentSettingsModal, {
      agent,
      modelProfiles: [],
      onLoadProfiles: () => undefined,
      onSave: async () => undefined,
      onEditSystemPrompt: () => undefined,
      onClose: () => undefined,
    }))

    expect(html).toContain('系统提示词')
    expect(html).toContain('已配置')
    expect(html).toContain('14 字')
    expect(html).toContain('编辑')
    expect(html).not.toContain('<textarea')
  })

  test('keeps system prompt out of the basic Agent settings payload', () => {
    expect(settingsUpdate.buildAgentSettingsUpdate({
      name: '代码工程师',
      icon: 'bot',
      avatarUrl: null,
      modelProfileId: null,
      modelProfileMode: 'global',
    })).toMatchObject({
      name: '代码工程师',
    })
    expect(settingsUpdate.buildAgentSettingsUpdate({
      name: '代码工程师',
      icon: 'bot',
      avatarUrl: null,
      modelProfileId: null,
      modelProfileMode: 'global',
    })).not.toHaveProperty('systemPrompt')
  })

  test('provides a dedicated prompt editor with independent save semantics', () => {
    const html = renderToStaticMarkup(createElement(AgentSystemPromptEditorModal, {
      agent,
      onSave: async () => undefined,
      onClose: () => undefined,
    }))

    expect(html).toContain('编辑系统提示词')
    expect(html).toContain('下一轮消息生效')
    expect(html).toContain('height:70vh')
    expect(html).toContain('<textarea')
    expect(html).toContain('只修改当前需求范围内的代码。')
    expect(settingsUpdate.buildAgentSystemPromptUpdate('')).toEqual({ systemPrompt: '' })
  })
})
