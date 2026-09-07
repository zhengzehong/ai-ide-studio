import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { AdvisorTabBar, SuggestionPanel } from '../../ui/src/pages/workspace/SuggestionPanel.js'
import { SuggestionTaskDialog } from '../../ui/src/pages/workspace/SuggestionTaskDialog.js'
import { AdvisorSettingsDialog } from '../../ui/src/pages/workspace/AdvisorSettingsDialog.js'
import { isGlmAgent } from '../../ui/src/stores/advisor.store.js'
import type { AdvisorSuggestion, AdvisorSuggestionView } from '../../ui/src/stores/advisor.store.js'
import type { AgentData } from '../../ui/src/stores/agent.store.js'
import type { SessionData } from '../../ui/src/stores/session.store.js'

const DESCRIPTION = '## 背景\n排查结论没有沉淀。\n## 目标\n把结论整理成可执行任务。'

function suggestionFixture(overrides: Partial<AdvisorSuggestion> = {}): AdvisorSuggestion {
  return {
    id: 'suggestion-1',
    project_id: 'project-1',
    round_id: 'round-1',
    trigger_session_id: 'session-1',
    sort_order: 0,
    type: 'plan',
    title: '沉淀排查结论为任务',
    description_markdown: DESCRIPTION,
    artifact_json: JSON.stringify({ name: 'suggestion-1-方案.html', relativePath: 'advisor-artifacts/project-1', size: 2048, previewId: 'preview-1' }),
    source_evidence_json: JSON.stringify([{ sessionId: 'session-1', title: '性能排查会话' }]),
    suggested_agent_id: 'agent-glm',
    agent_reason: '改动小且快，glm 更合适',
    status: 'pending',
    dispatch_token: null,
    task_id: null,
    execution_session_id: null,
    created_at: '2026-09-03T00:00:00.000Z',
    updated_at: '2026-09-03T00:00:00.000Z',
    expire_at: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function viewFixture(overrides: Partial<AdvisorSuggestionView> = {}): AdvisorSuggestionView {
  return {
    suggestions: [suggestionFixture()],
    expired: [],
    settled: [],
    pendingCount: 1,
    ...overrides,
  }
}

function agentFixture(overrides: Partial<AgentData> = {}): AgentData {
  return {
    id: 'agent-glm',
    name: 'coder-glm5',
    type: 'dev',
    runtime: 'mock',
    status: 'standby',
    permission_level: 2,
    config_json: null,
    project_id: 'project-1',
    template_id: null,
    system_prompt: '',
    icon: 'bot',
    avatar_url: null,
    sort_order: 0,
    hidden_at: null,
    created_at: '2026-09-03T00:00:00.000Z',
    ...overrides,
  }
}

function sessionFixture(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'session-glm',
    agent_id: 'agent-glm',
    task_id: null,
    acp_session_id: null,
    status: 'active',
    stage: 'chat',
    started_at: '2026-09-03T00:00:00.000Z',
    closed_at: null,
    title: 'glm 执行会话',
    ...overrides,
  }
}

const noop = () => undefined

function renderPanel(view: AdvisorSuggestionView | null, overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(SuggestionPanel, {
    view,
    loading: false,
    error: null,
    agents: [agentFixture()],
    highlightIds: [],
    onJumpToSession: noop,
    onOpenArtifact: noop,
    onExecute: noop,
    onIgnore: noop,
    onOpenTask: noop,
    onRetry: noop,
    ...overrides,
  }))
}

describe('advisor suggestion panel (PC)', () => {
  test('renders the four states: loading, error, empty, and data', () => {
    expect(renderToStaticMarkup(createElement(SuggestionPanel, {
      view: null, loading: true, error: null, agents: [], highlightIds: [],
      onJumpToSession: noop, onOpenArtifact: noop, onExecute: noop, onIgnore: noop, onOpenTask: noop, onRetry: noop,
    }))).toContain('正在加载参谋建议')

    const errorHtml = renderToStaticMarkup(createElement(SuggestionPanel, {
      view: null, loading: false, error: '参谋建议加载失败', agents: [], highlightIds: [],
      onJumpToSession: noop, onOpenArtifact: noop, onExecute: noop, onIgnore: noop, onOpenTask: noop, onRetry: noop,
    }))
    expect(errorHtml).toContain('参谋建议加载失败')
    expect(errorHtml).toContain('重试')

    expect(renderPanel(viewFixture({ suggestions: [], pendingCount: 0 }))).toContain('参谋没有值得说的会保持沉默')

    const dataHtml = renderPanel(viewFixture())
    expect(dataHtml).toContain('沉淀排查结论为任务')
  })

  test('cards show type label, source pill, artifact open bar, and recommended agent', () => {
    const html = renderPanel(viewFixture())

    expect(html).toContain('📄 方案')
    expect(html).toContain('来源：性能排查会话')
    // 产出只走预览通道：出现「打开」按钮，绝不内联渲染 HTML
    expect(html).toContain('打开')
    expect(html).not.toContain('<html')
    expect(html).toContain('suggestion-1-方案.html')
    expect(html).toContain('2.0 KB')
    expect(html).toContain('coder-glm5')
    expect(html).toContain(isGlmAgent('coder-glm5') ? '推荐 · 快、便宜、中文好' : '')
  })

  test('action cards expose exactly two actions and no detail button', () => {
    const html = renderPanel(viewFixture())

    expect(html).toContain('▶ 查看并执行')
    expect(html).toContain('忽略')
    expect(html).not.toContain('详情')
  })

  test('tab bar shows a pending-only badge that pulses on new arrivals', () => {
    const badge = renderToStaticMarkup(createElement(AdvisorTabBar, {
      active: 'tasks', pendingCount: 3, pulse: true,
      onSelectTab: noop, onOpenSettings: noop, onCreateTask: noop,
    }))
    expect(badge).toContain('advisor-tab-badge-pulse')
    expect(badge).toContain('>3<')

    const viewedOnly = renderToStaticMarkup(createElement(AdvisorTabBar, {
      active: 'suggestions', pendingCount: 0, pulse: false,
      onSelectTab: noop, onOpenSettings: noop, onCreateTask: noop,
    }))
    expect(viewedOnly).not.toContain('advisor-tab-badge')
    expect(viewedOnly).toContain('参谋设置')

    const tasksTab = renderToStaticMarkup(createElement(AdvisorTabBar, {
      active: 'tasks', pendingCount: 0, pulse: false,
      onSelectTab: noop, onOpenSettings: noop, onCreateTask: noop,
    }))
    expect(tasksTab).toContain('新建')
  })

  test('viewed suggestions stay in the main list; settled and expired collapse to the bottom', () => {
    const viewed = suggestionFixture({ id: 'suggestion-viewed', status: 'viewed' })
    const accepted = suggestionFixture({ id: 'suggestion-accepted', status: 'accepted', task_id: 'task-1', execution_session_id: 'session-2' })
    const ignored = suggestionFixture({ id: 'suggestion-ignored', status: 'ignored' })
    const expired = suggestionFixture({ id: 'suggestion-expired', status: 'pending' })
    const html = renderPanel(viewFixture({
      suggestions: [viewed],
      settled: [accepted, ignored],
      expired: [expired],
      pendingCount: 0,
    }))

    expect(html).toContain('沉淀排查结论为任务')
    expect(html).toContain('已处理（1 条）')
    expect(html).toContain('已忽略（1 条）')
    expect(html).toContain('已过期（1 条）')
    expect(html).not.toContain('已处理（2 条）')
    // 折叠区默认收起：终态卡片内容不直接出现
    expect(html).not.toContain('✔ 已派发执行')
  })

  test('execute dialog edits title and description with three footer actions', () => {
    const html = renderToStaticMarkup(createElement(SuggestionTaskDialog, {
      suggestion: suggestionFixture(),
      agents: [agentFixture()],
      sessions: [sessionFixture()],
      busy: false,
      onClose: noop,
      onConfirm: async () => undefined,
    }))

    expect(html).toContain('value="沉淀排查结论为任务"')
    expect(html).toContain('查看并执行建议')
    expect(html).toContain('只创建任务')
    expect(html).toContain('创建并执行')
    expect(html).toContain('取消')
    expect(html).toContain('AI 推荐理由')
  })

  test('falls back with a hint when the suggested agent is not in the project', () => {
    const html = renderToStaticMarkup(createElement(SuggestionTaskDialog, {
      suggestion: suggestionFixture({ suggested_agent_id: 'agent-gone' }),
      agents: [agentFixture()],
      sessions: [],
      busy: false,
      onClose: noop,
      onConfirm: async () => undefined,
    }))

    expect(html).toContain('不在当前项目 Agent 列表中')
    // 回落：不预选已消失的推荐 Agent，回落到「请选择 Agent」占位
    expect(html).not.toContain('value="agent-gone"')
    expect(html).toContain('<option value="" selected="">请选择 Agent</option>')
  })

  test('settings dialog has the toggle, agent select, advanced collapse, and no daily cap', () => {
    const html = renderToStaticMarkup(createElement(AdvisorSettingsDialog, {
      config: {
        projectId: 'project-1',
        sessionId: 'session-1',
        advisorAgentId: 'agent-glm',
        advisorPrompt: '默认偏好',
        defaultAdvisorPrompt: '当前系统默认',
        minSilenceMinutes: 5,
        enabled: true,
        lastError: null,
        createdAt: '2026-09-03T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
      agents: [agentFixture()],
      saving: false,
      onClose: noop,
      onSave: async () => undefined,
      onRebuild: async () => undefined,
    }))

    expect(html).toContain('启用 AI 参谋')
    expect(html).toContain('参谋 Agent')
    expect(html).toContain('高级：自定义参谋偏好')
    expect(html).not.toContain('每日上限')
    expect(html).toContain('checked')
  })
})
