import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TeamAgentSettingsModal, TeamMemberRemoveConfirm } from '../../ui/src/components/team/TeamAgentSettingsModal.js'
import type { TeamDockMember, TeamMemberModelConfig } from '../../ui/src/components/team/TeamAgentDock.js'

function member(overrides: Partial<TeamDockMember> = {}): TeamDockMember {
  return {
    id: 'tm-1', agent_id: 'agent-1', session_id: 'session-1', name: 'Dev-GLM', role: 'member',
    ...overrides,
  }
}

function config(overrides: Partial<TeamMemberModelConfig> = {}): TeamMemberModelConfig {
  return {
    modelProfileMode: 'inherit', modelProfileId: null, systemPromptOverride: null, runtime: 'claude',
    effective: { name: 'gpt-6-astra', source: '继承 Master' },
    fallback: { name: '系统默认', source: '未指定档案' },
    agentSystemPrompt: '成员模板人设提示词',
    ...overrides,
  }
}

function renderModal(overrides: {
  member?: TeamDockMember
  config?: TeamMemberModelConfig
  masterEffective?: { name: string; source: string } | null
  modelProfiles?: Array<{ id: string; name: string; runtime: string; enabled: boolean; is_default?: boolean }>
} = {}): string {
  return renderToStaticMarkup(createElement(TeamAgentSettingsModal, {
    member: overrides.member ?? member(),
    config: overrides.config ?? config(),
    masterEffective: overrides.masterEffective === undefined ? { name: 'gpt-6-astra', source: 'Master 档案' } : overrides.masterEffective,
    modelProfiles: (overrides.modelProfiles ?? []) as never,
    onLoadProfiles: () => undefined,
    onSave: () => Promise.resolve(),
    onSaveSystemPrompt: () => Promise.resolve(),
    onRemoveRequest: () => undefined,
    onClose: () => undefined,
  }))
}

describe('team agent settings modal', () => {
  it('renders the three policy fields with the team-scope note and current effect hint', () => {
    const html = renderModal()
    expect(html).toContain('模型策略')
    expect(html).toContain('继承 Master')
    expect(html).toContain('固定模型档案')
    expect(html).toContain('使用系统默认')
    expect(html).toContain('当前生效')
    expect(html).toContain('gpt-6-astra · 继承 Master')
    expect(html).toContain('仅对当前团队生效')
    expect(html).toContain('下一轮对话生效')
    expect(html).toContain('取消')
    expect(html).toContain('保存')
  })

  it('disables the profile select unless fixed mode is chosen, filtered by member runtime', () => {
    const profiles = [
      { id: 'p-claude', name: 'Claude 档案', runtime: 'claude', enabled: true },
      { id: 'p-codex', name: 'Codex 档案', runtime: 'codex', enabled: true },
      { id: 'p-disabled', name: '停用档案', runtime: 'claude', enabled: false },
    ]
    const html = renderModal({ modelProfiles: profiles })
    expect(html).toContain('Claude 档案')
    expect(html).not.toContain('Codex 档案')
    expect(html).not.toContain('停用档案')
    expect(html).toContain('disabled')
  })

  it('hides the inherit option and the remove button for the master', () => {
    const html = renderModal({ member: member({ name: 'Master', role: 'leader' }) })
    expect(html).not.toContain('继承 Master</option>')
    expect(html).not.toContain('移除成员')
    expect(html).not.toContain('value="inherit"')
  })

  it('shows the remove button and remove entry for plain members', () => {
    const html = renderModal()
    expect(html).toContain('移除成员')
  })

  it('previews the system-default policy with the backend fallback resolution', () => {
    const html = renderModal({ config: config({ modelProfileMode: 'system', fallback: { name: 'agent-own-model', source: 'Agent 配置' } }) })
    // 预览文案由后端 fallback 驱动（展示即所得），而不是前端写死「系统默认」。
    expect(html).toContain('agent-own-model · Agent 配置')
  })

  it('fills the single prompt box with the agent real system prompt and drops the override layer', () => {
    // 方案 A：无预览层，单框直接预填 Agent 当前真实提示词（含 spawn 时配置的值）。
    const html = renderModal({ config: config({ agentSystemPrompt: 'Master 配置的检查员人设' }) })
    expect(html).toContain('Master 配置的检查员人设</textarea>')
    expect(html).not.toContain('当前提示词（Agent 原值）')

    // 文案如实：全局生效，删除覆盖语义。
    expect(html).toContain('直接修改该 Agent 的系统提示词（全局生效，含团队外单独聊天）')
    expect(html).not.toContain('仅在本团队内替换')
    expect(html).not.toContain('留空则使用该 Agent 当前提示词')
    expect(html).toContain('模型策略仅对当前团队生效，不修改项目里的全局 Agent')
  })

  it('renders an empty prompt box when the agent has no system prompt', () => {
    const html = renderModal({ config: config({ agentSystemPrompt: null }) })
    expect(html).toContain('<textarea')
    expect(html).not.toContain('（该 Agent 未设置系统提示词）')
  })

  it('renders the remove confirmation with history-retention wording', () => {
    const html = renderToStaticMarkup(createElement(TeamMemberRemoveConfirm, {
      memberName: 'Dev-GLM', busy: false, onCancel: () => undefined, onConfirm: () => undefined,
    }))
    expect(html).toContain('移除「Dev-GLM」')
    expect(html).toContain('历史消息会保留')
    expect(html).toContain('之后可重新添加')
    expect(html).toContain('移除')
    expect(html).toContain('取消')
  })
})
