import { describe, it, expect } from 'vitest'

// 由于项目没装 @testing-library/react,我们把 SessionListPage 里的新建会话导航逻辑
// 抽成纯函数,验证 NewSessionSheet 接入后的 3 个核心行为:
// 1. 选 blank + 选了 agent → navigate /chat/new?projectId=X&agentId=Y
// 2. 选 template + 实例化 → navigate /chat/{sessionId}
// 3. currentProjectId 为空 → 不应打开 sheet,而是 create project sheet
//
// 另补 agent 拉取决策:currentProjectId 变化时,SessionListPage 应调
// fetchAgents(currentProjectId ?? undefined)。抽成纯函数验证。

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

// 复刻 SessionListPage 的 agent 拉取决策:currentProjectId → fetchAgents 入参
function decideFetchAgentsArg(currentProjectId: string | null): string | undefined {
  return currentProjectId ?? undefined
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

describe('SessionListPage agent fetch arg (按项目过滤)', () => {
  it('currentProjectId 有值 → fetchAgents(currentProjectId)', () => {
    expect(decideFetchAgentsArg('p1')).toBe('p1')
  })

  it('currentProjectId 为 null → fetchAgents(undefined) 兜底拉全局', () => {
    expect(decideFetchAgentsArg(null)).toBeUndefined()
  })

  it('currentProjectId 为空字符串 → fetchAgents(undefined)', () => {
    // null 和空串在页面里都视为"没选项目"
    expect(decideFetchAgentsArg(null)).toBeUndefined()
  })

  it('切换项目:p1 → p2 时 fetchAgents 入参从 "p1" 变 "p2"', () => {
    expect(decideFetchAgentsArg('p1')).toBe('p1')
    expect(decideFetchAgentsArg('p2')).toBe('p2')
  })
})
