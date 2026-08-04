import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { AutonomyAgentList } from '../../ui/src/pages/autonomy/AutonomyAgentList.js'
import { AutonomyControlPanel } from '../../ui/src/pages/autonomy/AutonomyControlPanel.js'
import { AutonomyReportStream } from '../../ui/src/pages/autonomy/AutonomyReportStream.js'
import type { AgentAutonomyStateData } from '../../ui/src/stores/autonomy.store.js'

const state: AgentAutonomyStateData = {
  agentId: 'agent-a',
  projectId: 'project-a',
  runtime: 'claude',
  config: {
    enabled: true,
    prompt: '关注产品质量。',
    interests: [{ id: 'interest-a', text: '会话稳定性', createdAt: '2026-08-05T00:00:00.000Z' }],
    plan: {
      date: '2026-08-05',
      items: [
        { id: 'current', title: '排查会话延迟', status: 'current' },
        { id: 'next', title: '整理优化建议', status: 'next' },
      ],
      nextCheckAt: null,
      updatedAt: null,
    },
    autonomySessionId: 'session-a',
    lastRunAt: null,
    lastSkipReason: null,
    lastError: null,
  },
  session: null,
  memory: {
    path: 'C:/data/autonomy/project-a/agent-a/memory.md',
    content: '# 工作记忆\n\n已完成一次排查。',
    updatedAt: '2026-08-05T00:00:00.000Z',
    truncated: false,
  },
}

describe('Autonomy PC UI', () => {
  test('renders Agent state, interests, plan and the full Markdown memory', () => {
    const agents = renderToStaticMarkup(createElement(AutonomyAgentList, {
      agents: [{
        id: 'agent-a', type: 'pm', name: '项目管家', runtime: 'claude', status: 'standby',
        permission_level: 3, config_json: null, created_at: '2026-08-05T00:00:00.000Z',
      }],
      states: [state],
      selectedAgentId: 'agent-a',
      onSelect: () => undefined,
    }))
    const controls = renderToStaticMarkup(createElement(AutonomyControlPanel, {
      state,
      saving: false,
      onAddInterest: async () => undefined,
      onRemoveInterest: async () => undefined,
      onSavePrompt: async () => undefined,
    }))

    expect(agents).toContain('项目管家')
    expect(agents).toContain('已启用')
    expect(controls).toContain('会话稳定性')
    expect(controls).toContain('排查会话延迟')
    expect(controls).toContain('工作记忆')
    expect(controls).toContain('已完成一次排查')
  })

  test('renders a single report stream with priority and GFM content', () => {
    const html = renderToStaticMarkup(createElement(AutonomyReportStream, {
      reports: [{
        id: 'report-a', project_id: 'project-a', agent_id: 'agent-a', session_id: 'session-a',
        title: '稳定性结论', summary: '发现一个根因。', priority: 'P0',
        body_markdown: '## 根因\n\n- 连接未恢复', attachments: [], created_at: '2026-08-05T01:00:00.000Z',
      }],
    }))

    expect(html).toContain('稳定性结论')
    expect(html).toContain('P0')
    expect(html).toContain('根因')
    expect(html).toContain('连接未恢复')
  })
})
