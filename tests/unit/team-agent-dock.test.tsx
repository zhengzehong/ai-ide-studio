import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TeamAgentDock, deriveMemberStatus } from '../../ui/src/components/team/TeamAgentDock.js'
import type { TeamDockMember } from '../../ui/src/components/team/TeamAgentDock.js'
import type { Snapshot } from '../../ui/src/components/team/team-chat-state.js'
import { emptySnapshot } from '../../ui/src/components/team/team-chat-state.js'

function member(overrides: Partial<TeamDockMember> = {}): TeamDockMember {
  return {
    id: 'tm-1', agent_id: 'agent-1', session_id: 'session-1', name: 'Dev-GLM', role: 'member',
    modelConfig: {
      modelProfileMode: 'inherit', modelProfileId: null, systemPromptOverride: null, runtime: 'claude',
      effective: { name: 'gpt-6-astra', source: '继承 Master' },
      fallback: { name: '系统默认', source: '未指定档案' },
      agentSystemPrompt: '成员模板人设提示词',
    },
    ...overrides,
  }
}

function snapshotWith(overrides: Partial<Snapshot>): Snapshot {
  return { ...emptySnapshot('session-1'), ...overrides }
}

describe('team member live status derivation', () => {
  it('is idle without a snapshot or with a finished turn', () => {
    expect(deriveMemberStatus(undefined)).toEqual({ running: false, waiting: false, label: '空闲' })
    expect(deriveMemberStatus(snapshotWith({ streaming: { id: 'm1', done: true } as never }))).toEqual({ running: false, waiting: false, label: '空闲' })
  })

  it('surfaces pending permission as waiting', () => {
    const status = deriveMemberStatus(snapshotWith({ permissions: [{ id: 'perm-1' } as never] }))
    expect(status).toEqual({ running: true, waiting: true, label: '等待权限' })
  })

  it('follows the streaming stage text like the message stream does', () => {
    const status = deriveMemberStatus(snapshotWith({ streaming: { id: 'm1', done: false, stage: '正在检查 13 项核实…', content: '', thinking: '', processBlocks: [], toolCalls: [] } as never }))
    expect(status).toMatchObject({ running: true, label: '正在检查 13 项核实…' })
  })

  it('labels a thinking-only turn as thinking and any other streaming turn as running', () => {
    const thinking = deriveMemberStatus(snapshotWith({ streaming: { id: 'm1', done: false, stage: '', content: '', thinking: '分析任务', processBlocks: [], toolCalls: [] } as never }))
    expect(thinking).toMatchObject({ running: true, label: '正在思考...' })
    const running = deriveMemberStatus(snapshotWith({ streaming: { id: 'm1', done: false, content: '进展', thinking: '', processBlocks: [], toolCalls: [] } as never }))
    expect(running).toMatchObject({ running: true, label: '执行中' })
  })
})

describe('team agent dock rendering', () => {
  it('renders member rows with role tags and the effective model source from the backend', () => {
    const html = renderToStaticMarkup(createElement(TeamAgentDock, {
      initialCollapsed: false,
      members: [
        member({ id: 'tm-0', name: 'Master', role: 'leader', session_id: 'master-session', modelConfig: { modelProfileMode: 'fixed', modelProfileId: 'p1', systemPromptOverride: null, runtime: 'claude', effective: { name: 'gpt-6-astra', source: 'Master 档案' }, fallback: { name: 'gpt-6-astra', source: 'Agent 配置' }, agentSystemPrompt: 'Master 人设' } }),
        member(),
      ],
      statusBySessionId: {
        'master-session': { running: true, waiting: false, label: '执行中' },
        'session-1': { running: false, waiting: false, label: '空闲' },
      },
      onLocate: () => undefined,
      onOpenSettings: () => undefined,
      onRemoveRequest: () => undefined,
    }))
    expect(html).toContain('团队 Agent · 2 人')
    expect(html).toContain('主控')
    expect(html).toContain('成员')
    expect(html).toContain('gpt-6-astra')
    expect(html).toContain('继承 Master')
    expect(html).toContain('Master 档案')
    expect(html).toContain('执行中')
    expect(html).toContain('空闲')
    expect(html).toContain('点击定位该成员消息')
  })

  it('collapses by default to a floating bar with status dots but no member rows', () => {
    const html = renderToStaticMarkup(createElement(TeamAgentDock, {
      members: [member()],
      statusBySessionId: { 'session-1': { running: false, waiting: false, label: '空闲' } },
      onLocate: () => undefined,
      onOpenSettings: () => undefined,
      onRemoveRequest: () => undefined,
    }))
    expect(html).toContain('团队 Agent · 1 人')
    // 默认收起：悬浮细条（position:absolute）只有头部，不渲染成员行、不占布局
    expect(html).toContain('position:absolute')
    // 固定锚在输入框本体上方：offset 144 = 输入框静止高度 120 + shell 底边距 16 + 间距 8，不随图片条/错误行移动
    expect(html).toContain('bottom:144px')
    // 组件内置 <style> 里也带 .team-agent-dock-row 选择器，只认元素本身的 class
    expect(html).not.toContain('class="team-agent-dock-row')
    expect(html).not.toContain('点击定位该成员消息')
  })
})
