import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { AgentSettingsModal } from '../../ui/src/components/agent/AgentSettingsModal.tsx'
import { buildAgentSettingsUpdate } from '../../ui/src/components/agent/agent-settings-update.ts'
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
  test('shows the deployed Agent prompt and explains next-turn activation', () => {
    const html = renderToStaticMarkup(createElement(AgentSettingsModal, {
      agent,
      modelProfiles: [],
      onLoadProfiles: () => undefined,
      onSave: async () => undefined,
      onClose: () => undefined,
    }))

    expect(html).toContain('系统提示词')
    expect(html).toContain('只修改当前需求范围内的代码。')
    expect(html).toContain('下一轮消息生效')
  })

  test('keeps an empty prompt in the update payload so users can clear it', () => {
    expect(buildAgentSettingsUpdate({
      name: '代码工程师',
      icon: 'bot',
      avatarUrl: null,
      modelProfileId: null,
      modelProfileMode: 'global',
      systemPrompt: '',
    })).toMatchObject({
      name: '代码工程师',
      systemPrompt: '',
    })
  })
})
