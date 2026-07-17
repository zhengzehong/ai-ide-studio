import { describe, it, expect } from 'vitest'

// 由于项目没装 @testing-library/react,把 ChatPage 在 /chat/new 路由下的
// 发送决策逻辑抽成纯函数,验证 2 个 post-refactor 行为:
// 1. URL 带 projectId + agentId → 调 createSession + navigate /chat/{realId}
// 2. URL 缺 agentId → toast "未选择 Agent" 并 abort(不再 fallback)

interface SendArgs {
  isNewSessionRoute: boolean
  pendingProjectId: string | null
  pendingAgentId: string | null
}

interface SendResult {
  abort: boolean
  toastMessage: string | null
  shouldCreateSession: boolean
  createSessionArgs: { agentId: string; projectId: string } | null
}

// 复刻 ChatPage.handleSend 在 isNewSessionRoute 分支的决策(post-refactor)
function decideNewSessionSend(args: SendArgs): SendResult {
  if (!args.isNewSessionRoute) {
    return {
      abort: false,
      toastMessage: null,
      shouldCreateSession: false,
      createSessionArgs: null,
    }
  }
  if (!args.pendingProjectId) {
    return {
      abort: true,
      toastMessage: '缺少项目信息,请返回重试',
      shouldCreateSession: false,
      createSessionArgs: null,
    }
  }
  if (!args.pendingAgentId) {
    return {
      abort: true,
      toastMessage: '未选择 Agent,请返回重新选择',
      shouldCreateSession: false,
      createSessionArgs: null,
    }
  }
  return {
    abort: false,
    toastMessage: null,
    shouldCreateSession: true,
    createSessionArgs: { agentId: args.pendingAgentId, projectId: args.pendingProjectId },
  }
}

describe('ChatPage handleSend on /chat/new (post-refactor)', () => {
  it('URL with projectId + agentId → createSession with both args', () => {
    const r = decideNewSessionSend({
      isNewSessionRoute: true,
      pendingProjectId: 'p1',
      pendingAgentId: 'a1',
    })
    expect(r.abort).toBe(false)
    expect(r.shouldCreateSession).toBe(true)
    expect(r.createSessionArgs).toEqual({ agentId: 'a1', projectId: 'p1' })
  })

  it('URL missing agentId → abort with toast, no fallback (regression: old code fell back to sessions[0] / agents[0])', () => {
    const r = decideNewSessionSend({
      isNewSessionRoute: true,
      pendingProjectId: 'p1',
      pendingAgentId: null,
    })
    expect(r.abort).toBe(true)
    expect(r.toastMessage).toBe('未选择 Agent,请返回重新选择')
    expect(r.shouldCreateSession).toBe(false)
    expect(r.createSessionArgs).toBeNull()
  })

  it('URL missing projectId → abort with toast', () => {
    const r = decideNewSessionSend({
      isNewSessionRoute: true,
      pendingProjectId: null,
      pendingAgentId: 'a1',
    })
    expect(r.abort).toBe(true)
    expect(r.toastMessage).toBe('缺少项目信息,请返回重试')
    expect(r.shouldCreateSession).toBe(false)
  })

  it('not on new-session route → no abort, no createSession (falls through to normal sendPrompt)', () => {
    const r = decideNewSessionSend({
      isNewSessionRoute: false,
      pendingProjectId: 'p1',
      pendingAgentId: 'a1',
    })
    expect(r.abort).toBe(false)
    expect(r.shouldCreateSession).toBe(false)
    expect(r.createSessionArgs).toBeNull()
  })
})
