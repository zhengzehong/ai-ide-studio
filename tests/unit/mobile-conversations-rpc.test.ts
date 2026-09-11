import { describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

const { list, active } = vi.hoisted(() => ({ list: vi.fn(), active: vi.fn() }))
vi.mock('../../src/core/mobile-conversations.js', () => ({ listMobileConversationCatalog: list }))
vi.mock('../../src/core/sessions.js', () => ({ sessionManager: { isPromptActive: active } }))
import { mobileConversationRpcHandlers } from '../../src/gateway/rpc/mobile-conversations.js'

function context(authMode: 'owner' | 'guest'): RpcContext {
  return { state: { authMode, subscriptions: new Set() }, sendResult: vi.fn(), sendError: vi.fn(), sendOutOfBandError: vi.fn() }
}

describe('mobile conversation RPC', () => {
  it('rejects guests before reading project metadata', () => {
    list.mockClear()
    expect(() => mobileConversationRpcHandlers['mobile.conversations.list']({ type: 'mobile.conversations.list' }, context('guest'))).toThrow('无权')
    expect(list).not.toHaveBeenCalled()
  })

  it('passes owner project scope and live runtime state into the catalog', () => {
    const result = { teams: [], conversations: [], hiddenAgentIds: [], hiddenSessionIds: [] }
    list.mockReturnValue(result)
    active.mockReturnValue(true)
    const ctx = context('owner')
    mobileConversationRpcHandlers['mobile.conversations.list']({ type: 'mobile.conversations.list', projectId: 'p' }, ctx)
    expect(list).toHaveBeenLastCalledWith('p', expect.any(Function))
    expect(list.mock.calls.at(-1)![1]('s')).toBe(true)
    expect(active).toHaveBeenLastCalledWith('s')
    expect(ctx.sendResult).toHaveBeenCalledWith(result)
  })
})
