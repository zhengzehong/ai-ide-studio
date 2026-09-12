import { describe, expect, it } from 'vitest'
import { buildTeamActivity } from '../../ui/src/components/team/team-activity-view.js'
import type { MessageData, StreamingMessage } from '../../ui/src/stores/session-events.js'

const now = Date.parse('2026-09-12T10:00:00Z')
function message(id: string, completedAt: number, name = '同名成员'): MessageData {
  return { id, session_id: 'master', role: 'agent', content: '回复', thinking: null, tool_calls_json: null, decision_json: null, timestamp: new Date(completedAt).toISOString(), completed_at: new Date(completedAt).toISOString(), sender_name: name, status: 'completed' }
}
function turn(id: string): StreamingMessage {
  return { id, role: 'agent', content: '', finalAnswer: '', thinking: '', processBlocks: [], toolCalls: [], done: false, senderName: '同名成员' }
}
describe('team local activity', () => {
  it('does not count loaded old history as a new unread reply', () => {
    expect(buildTeamActivity([message('a:old', now - 1)], [], {}, new Set(), now)).toEqual([])
  })
  it('keeps same-name members separate and combines running/unread within one member', () => {
    const states = buildTeamActivity([message('a:reply', now + 1)], [turn('a:live'), turn('b:live')], {}, new Set(), now)
    expect(states).toHaveLength(2)
    expect(states[0]).toMatchObject({ id: 'a', running: true, unread: true, messageId: 'a:live' })
    expect(states[1]).toMatchObject({ id: 'b', running: true, unread: false })
  })
  it('hides a finished member only after its new reply has actually been seen', () => {
    const reply = message('a:reply', now + 1)
    expect(buildTeamActivity([reply], [], {}, new Set(), now)[0]).toMatchObject({ running: false, unread: true })
    expect(buildTeamActivity([reply], [], {}, new Set([reply.id]), now)).toEqual([])
  })
  it('does not mark an unseen new reply seen because the previous reply was seen', () => {
    const states = buildTeamActivity([message('a:old', now + 1), message('a:new', now + 2)], [], { a: 'agent-1' }, new Set(['a:old']), now)
    expect(states[0]).toMatchObject({ id: 'agent-1', messageId: 'a:new', unread: true })
  })
})
