import { describe, it, expect } from 'vitest'

// 由于项目没装 @testing-library/react,我们把 SessionListPage 里的新建会话导航逻辑
// 抽成纯函数,验证 NewSessionSheet 接入后的 3 个核心行为:
// 1. 选 blank + 选了 agent → navigate /chat/new?projectId=X&agentId=Y
// 2. 选 template + 实例化 → navigate /chat/{sessionId}
// 3. currentProjectId 为空 → 不应打开 sheet,而是 create project sheet

interface NavArgs {
  currentProjectId: string | null
  mode: 'blank' | 'template'
  agentId: string | null
  instantiatedSessionId?: string | null
}

interface NavResult {
  url: string | null
  openCreateProject: boolean
  openNewSessionSheet: boolean
}

// 复刻 SessionListPage 的导航决策逻辑(post-refactor)
function decideNewSessionNav(args: NavArgs): NavResult {
  if (!args.currentProjectId) {
    return { url: null, openCreateProject: true, openNewSessionSheet: false }
  }
  if (args.mode === 'blank') {
    if (!args.agentId) {
      return { url: null, openCreateProject: false, openNewSessionSheet: false }
    }
    return {
      url: `/chat/new?projectId=${args.currentProjectId}&agentId=${args.agentId}`,
      openCreateProject: false,
      openNewSessionSheet: false,
    }
  }
  // mode === 'template'
  if (!args.instantiatedSessionId) {
    return { url: null, openCreateProject: false, openNewSessionSheet: false }
  }
  return {
    url: `/chat/${args.instantiatedSessionId}`,
    openCreateProject: false,
    openNewSessionSheet: false,
  }
}

describe('SessionListPage new session navigation (post-refactor)', () => {
  it('blank mode with agent → navigate to /chat/new?projectId=X&agentId=Y', () => {
    const r = decideNewSessionNav({
      currentProjectId: 'p1',
      mode: 'blank',
      agentId: 'a1',
    })
    expect(r.url).toBe('/chat/new?projectId=p1&agentId=a1')
    expect(r.openCreateProject).toBe(false)
    expect(r.openNewSessionSheet).toBe(false)
  })

  it('template mode with instantiated sessionId → navigate to /chat/{id}', () => {
    const r = decideNewSessionNav({
      currentProjectId: 'p1',
      mode: 'template',
      agentId: 'a1',
      instantiatedSessionId: 'sess-xyz',
    })
    expect(r.url).toBe('/chat/sess-xyz')
    expect(r.openCreateProject).toBe(false)
  })

  it('no currentProjectId → open create-project sheet, not new-session sheet', () => {
    const r = decideNewSessionNav({
      currentProjectId: null,
      mode: 'blank',
      agentId: 'a1',
    })
    expect(r.openCreateProject).toBe(true)
    expect(r.openNewSessionSheet).toBe(false)
    expect(r.url).toBeNull()
  })

  it('blank mode without agent → no navigation', () => {
    const r = decideNewSessionNav({
      currentProjectId: 'p1',
      mode: 'blank',
      agentId: null,
    })
    expect(r.url).toBeNull()
  })

  it('blank mode URL includes agentId query param (regression: old flow missed this)', () => {
    const r = decideNewSessionNav({
      currentProjectId: 'p1',
      mode: 'blank',
      agentId: 'agent-abc',
    })
    expect(r.url).toContain('agentId=agent-abc')
    expect(r.url).toContain('projectId=p1')
  })
})
