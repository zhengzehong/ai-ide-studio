import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../../ui/src/services/query-client'
import { emptySnapshot, updateStreaming, mergeMessage } from '../../ui/src/components/team/team-chat-state'
import { resolveTeamInteractionSession } from '../../ui/src/components/team/team-chat-adapter'
import { loadOlderTeamPages, mergeOlderTeamPages } from '../../ui/src/components/team/team-chat-history'
import { normalizeMessage } from '../../ui/src/stores/session-events'

afterEach(() => vi.restoreAllMocks())

describe('shared team adapter for mobile', () => {
  it('uses persisted final content instead of retaining an earlier streaming answer', () => {
    const previous = normalizeMessage({ id: 'worker:m', session_id: 'master', role: 'agent', content: '正在检查', finalAnswer: '正在检查', status: 'completed', timestamp: '' })
    const next = normalizeMessage({ ...previous, content: '最终结果', finalAnswer: undefined })
    expect(mergeMessage(previous, next).finalAnswer).toBe('最终结果')
    expect(mergeMessage(previous, { ...next, content: '' }).finalAnswer).toBe('正在检查')
  })
  it('routes member permissions and questions to the originating Session', () => {
    const member = { ...emptySnapshot('worker'), permissions: [{ id: 'permission', toolCall: { id: 'tool', title: '工具', status: 'pending' as const }, options: [] }], elicitations: [{ id: 'question' }] }
    const snapshots = { master: emptySnapshot('master'), worker: member }
    expect(resolveTeamInteractionSession(snapshots, 'permissions', 'permission')).toBe('worker')
    expect(resolveTeamInteractionSession(snapshots, 'elicitations', 'question')).toBe('worker')
    expect(() => resolveTeamInteractionSession(snapshots, 'permissions', 'unknown')).toThrow('失效')
  })
  it('continues pagination in another member when the oldest member is exhausted', async () => {
    const master = { ...emptySnapshot('master'), messages: [normalizeMessage({ id: 'master:m1', session_id: 'master', role: 'agent', content: '最早消息', timestamp: '2026-09-01T00:00:00Z' })], hasMore: false }
    const worker = { ...emptySnapshot('worker'), hasMore: true, senderName: '李白', messages: [normalizeMessage({ id: 'worker:w2', session_id: 'master', role: 'agent', content: '后续消息', timestamp: '2026-09-10T00:00:00Z' })] }
    const request = vi.spyOn(queryClient, 'listSessionMessages').mockResolvedValue({ items: [normalizeMessage({ id: 'w1', session_id: 'worker', role: 'agent', content: '之前的消息', timestamp: '2026-09-09T00:00:00Z' })], hasMore: false })
    const pages = await loadOlderTeamPages({ master, worker }, ['master', 'worker'], 'master')
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'worker', before: '2026-09-10T00:00:00Z' }))
    expect(pages[0].sources[0][1]).toMatchObject({ sourceSessionId: 'worker', sourceMessageId: 'w1' })
    const live = updateStreaming({ master, worker }, 'worker', { messageId: 'w3', contentDelta: '仍在输出' })
    const merged = mergeOlderTeamPages(live, pages)
    expect(merged.worker.messages.map(message => message.id)).toEqual(['worker:w1', 'worker:w2'])
    expect(merged.worker.streaming?.content).toBe('仍在输出')
    expect(mergeOlderTeamPages(merged, pages).worker.messages).toHaveLength(2)
  })
})
