import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { saveTeamAgentSettings, TeamAgentSettingsModal, TeamMemberRemoveConfirm } from '../../ui/src/components/team/TeamAgentSettingsModal.js'
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
    agentModelProfileId: null,
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
    onSaveAgentModel: () => Promise.resolve(),
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

  it('renders the master as a single model-profile select fed by the agent definition', () => {
    const profiles = [{ id: 'p1', name: 'claude-astra', runtime: 'claude', enabled: true }]
    const html = renderModal({
      member: member({ name: 'Master', role: 'leader' }),
      config: config({ agentModelProfileId: 'p1', effective: { name: 'claude-astra', source: 'Agent 配置' } }),
      modelProfiles: profiles,
    })
    // 策略下拉对 Master 无意义（创建团队时从模板新建的团队专属 Agent），只留模型档案单下拉。
    expect(html).not.toContain('模型策略')
    expect(html).not.toContain('value="inherit"')
    expect(html).not.toContain('请选择模型档案')
    expect(html).not.toContain('移除成员')
    expect(html).toContain('使用系统默认')
    // 预填 = Agent 定义的原始 model_profile_id。
    expect(html).toContain('value="p1" selected')
    // 当前生效 = 后端 effective（与 dock 行同源同文案），不再写死「系统默认 · Master 未指定档案」。
    expect(html).toContain('claude-astra · Agent 配置')
    expect(html).not.toContain('Master 未指定档案')
    expect(html).toContain('直接修改该 Agent 的模型配置（全局生效）')
    expect(html).not.toContain('模型策略仅对当前团队生效')
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

describe('team agent settings save orchestration', () => {
  const tick = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

  it('closes the modal only after every save succeeds', async () => {
    let resolveConfig: () => void = () => undefined
    let resolvePrompt: () => void = () => undefined
    let closed = 0
    const done = saveTeamAgentSettings({
      config: config({ modelProfileMode: 'inherit', modelProfileId: null, agentSystemPrompt: '旧人设' }),
      mode: 'fixed', profileId: 'p1', prompt: '新人设',
      onSave: () => new Promise<void>((resolve) => { resolveConfig = resolve }),
      onSaveAgentModel: null,
      onSaveSystemPrompt: () => new Promise<void>((resolve) => { resolvePrompt = resolve }),
      onClose: () => { closed += 1 },
    })
    await tick()
    expect(closed).toBe(0)
    resolveConfig()
    await tick()
    expect(closed).toBe(0)
    resolvePrompt()
    await expect(done).resolves.toBeUndefined()
    expect(closed).toBe(1)
  })

  it('keeps the modal open when one save fails while the succeeded part stays applied', async () => {
    let rejectPrompt: (cause: unknown) => void = () => undefined
    let closed = 0
    const done = saveTeamAgentSettings({
      config: config({ modelProfileMode: 'inherit', modelProfileId: null, agentSystemPrompt: '旧人设' }),
      mode: 'system', profileId: '', prompt: '新人设',
      onSave: () => Promise.resolve(),
      onSaveAgentModel: null,
      onSaveSystemPrompt: () => new Promise<void>((_, reject) => { rejectPrompt = reject }),
      onClose: () => { closed += 1 },
    })
    await tick()
    rejectPrompt(new Error('提示词保存失败（模拟）'))
    await expect(done).rejects.toThrow('提示词保存失败（模拟）')
    // 弹窗保持打开：不关（错误随后由组件 setError 展示在弹窗内）；已成功的模型策略更新由父级保留在本地状态。
    expect(closed).toBe(0)
  })

  it('skips already-saved parts on retry via the dirty check and closes', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const onSaveSystemPrompt = vi.fn(() => Promise.resolve())
    let closed = 0
    // 部分成功后父级已把本地 config 更新为真实值：模式/档案/提示词都与 config 一致 → 零写入直接关。
    await saveTeamAgentSettings({
      config: config({ modelProfileMode: 'fixed', modelProfileId: 'p1', agentSystemPrompt: '已保存人设' }),
      mode: 'fixed', profileId: 'p1', prompt: '已保存人设',
      onSave, onSaveAgentModel: null, onSaveSystemPrompt, onClose: () => { closed += 1 },
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(onSaveSystemPrompt).not.toHaveBeenCalled()
    expect(closed).toBe(1)
  })

  it('writes the model strategy with cleared profile outside fixed mode', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    await saveTeamAgentSettings({
      config: config({ modelProfileMode: 'fixed', modelProfileId: 'p1', agentSystemPrompt: '同值' }),
      mode: 'system', profileId: 'p1', prompt: '同值',
      onSave, onSaveAgentModel: null, onSaveSystemPrompt: vi.fn(() => Promise.resolve()), onClose: () => undefined,
    })
    expect(onSave).toHaveBeenCalledWith({ modelProfileMode: 'system', modelProfileId: null })
  })

  it('writes the master model profile to the agent definition when dirty', async () => {
    const onSaveAgentModel = vi.fn(() => Promise.resolve())
    let closed = 0
    await saveTeamAgentSettings({
      config: config({ agentModelProfileId: null, agentSystemPrompt: '同值' }),
      mode: 'inherit', profileId: 'p1', prompt: '同值',
      onSave: vi.fn(() => Promise.resolve()),
      onSaveAgentModel, onSaveSystemPrompt: vi.fn(() => Promise.resolve()),
      onClose: () => { closed += 1 },
    })
    expect(onSaveAgentModel).toHaveBeenCalledWith({ modelProfileId: 'p1' })
    expect(closed).toBe(1)
  })

  it('clears the master model profile to system default and skips when unchanged', async () => {
    const onSaveAgentModel = vi.fn(() => Promise.resolve())
    // 清空=使用系统默认：写 null。
    await saveTeamAgentSettings({
      config: config({ agentModelProfileId: 'p1', agentSystemPrompt: '同值' }),
      mode: 'inherit', profileId: '', prompt: '同值',
      onSave: vi.fn(() => Promise.resolve()),
      onSaveAgentModel, onSaveSystemPrompt: vi.fn(() => Promise.resolve()), onClose: () => undefined,
    })
    expect(onSaveAgentModel).toHaveBeenCalledWith({ modelProfileId: null })

    // 与 Agent 定义原值一致 → 不写，直接关。
    onSaveAgentModel.mockClear()
    let closed = 0
    await saveTeamAgentSettings({
      config: config({ agentModelProfileId: 'p1', agentSystemPrompt: '同值' }),
      mode: 'inherit', profileId: 'p1', prompt: '同值',
      onSave: vi.fn(() => Promise.resolve()),
      onSaveAgentModel, onSaveSystemPrompt: vi.fn(() => Promise.resolve()), onClose: () => { closed += 1 },
    })
    expect(onSaveAgentModel).not.toHaveBeenCalled()
    expect(closed).toBe(1)
  })
})
