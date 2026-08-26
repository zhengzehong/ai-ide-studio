import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { InspirationResult } from '../../ui/src/pages/inspiration/InspirationResult.js'
import { CandidateTaskDialog } from '../../ui/src/pages/inspiration/CandidateTaskDialog.js'
import { InspirationSettingsDialog } from '../../ui/src/pages/inspiration/InspirationSettingsDialog.js'
import type { InspirationCandidate, InspirationConfig, InspirationNote } from '../../ui/src/stores/inspiration.store.js'
import type { AgentData } from '../../ui/src/stores/agent.store.js'

describe('PC inspiration workbench', () => {
  test('renders a Markdown result with independently actionable candidates', () => {
    const html = renderToStaticMarkup(createElement(InspirationResult, {
      note: noteFixture(),
      onEdit: () => undefined,
      onRetry: () => undefined,
      onCandidateAction: () => undefined,
      onOpenTask: () => undefined,
      onOpenSession: () => undefined,
      onDiscuss: () => undefined,
    }))

    expect(html).toContain('AI 整理结果')
    expect(html).toContain('继续讨论')
    expect(html).toContain('候选任务')
    expect(html).toContain('编辑任务')
    expect(html).toContain('只创建')
    expect(html).toContain('执行此任务')
    expect(html).toContain('轻量级研发智能体')
  })

  test('requires explicit Agent and explains the dedicated execution Session', () => {
    const candidate = noteFixture().candidates[0]
    const html = renderToStaticMarkup(createElement(CandidateTaskDialog, {
      candidate,
      action: 'execute',
      agents: [agentFixture()],
      busy: false,
      onClose: () => undefined,
      onConfirm: async () => undefined,
    }))

    expect(html).toContain('执行 Agent')
    expect(html).toContain('默认创建独立任务会话')
    expect(html).toContain('创建并执行')
  })

  test('configures one organizer Agent and automatic organization', () => {
    const html = renderToStaticMarkup(createElement(InspirationSettingsDialog, {
      config: configFixture(),
      agents: [agentFixture()],
      saving: false,
      onClose: () => undefined,
      onSave: async () => undefined,
      onRebuild: async () => undefined,
    }))

    expect(html).toContain('一个项目只绑定一个当前长期灵感会话')
    expect(html).toContain('保存后自动整理')
    expect(html).toContain('模型档案、模式和推理强度继承')
  })

  test('registers the project route and navigation entry without touching mobile', () => {
    const app = readFileSync(resolve('ui/src/App.tsx'), 'utf8')
    const layout = readFileSync(resolve('ui/src/components/layout/AppLayout.tsx'), 'utf8')
    const page = readFileSync(resolve('ui/src/pages/Inspiration.tsx'), 'utf8')

    expect(app).toContain('<Route path="inspiration" element={<Inspiration />} />')
    expect(layout).toContain("{ to: '/inspiration', icon: Lightbulb, label: '灵感' }")
    expect(page).toContain('const allAgents = useAgentStore((state) => state.agents)')
    expect(page).toContain('() => allAgents.filter((agent) => agent.project_id === projectId && !agent.hidden_at)')
    expect(page).toContain('openSession(config.sessionId, selected.id)')
    expect(page).toContain('inspirationNoteId')
  })
})

function noteFixture(): InspirationNote {
  return {
    id: 'note-1',
    projectId: 'project-1',
    title: 'Agent 默认选择与偏好恢复',
    titleMode: 'manual',
    sourceMarkdown: '默认选中轻量级研发智能体。',
    attachments: [],
    status: 'ready',
    analysisRevision: 1,
    summary: '用户手动选择优先于系统默认。',
    bodyMarkdown: '## 建议方案\n\n保存并恢复用户偏好。',
    questions: ['偏好是否按项目保存？'],
    lastError: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:01:00.000Z',
    organizedAt: '2026-08-24T00:01:00.000Z',
    candidates: [candidateFixture()],
  }
}

function candidateFixture(): InspirationCandidate {
  return {
    id: 'candidate-1',
    noteId: 'note-1',
    analysisRevision: 1,
    sortOrder: 0,
    title: '实现 Agent 偏好恢复',
    descriptionMarkdown: '## 目标\n恢复用户选择。',
    suggestedAgentId: 'agent-1',
    suggestedAgentName: '轻量级研发智能体',
    agentReason: '适合明确的前后端改动',
    taskId: null,
    taskStatus: null,
    executionSessionId: null,
  }
}

function configFixture(): InspirationConfig {
  return {
    projectId: 'project-1',
    sessionId: 'session-1',
    organizerAgentId: 'agent-1',
    organizationPrompt: '整理灵感',
    autoOrganize: true,
    lastError: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

function agentFixture(): AgentData {
  return {
    id: 'agent-1',
    name: '轻量级研发智能体',
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
    created_at: '2026-08-24T00:00:00.000Z',
  }
}
