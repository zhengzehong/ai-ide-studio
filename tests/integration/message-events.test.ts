import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionStore, eventStore } from '../../src/store/sessions.js'

let tmp = ''

beforeEach(() => {
  closeDatabase()
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-message-events-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('eventStore.listByMessage', () => {
  test('returns only the selected assistant turn events in sequence order', () => {
    const session = sessionStore.create({ agentId: 'agent-message-events' })
    eventStore.append(session.id, {
      type: 'message.chunk',
      messageId: 'msg-a',
      role: 'agent',
      payload: { messageId: 'msg-a', role: 'agent', contentDelta: 'old answer' },
    })
    eventStore.append(session.id, {
      type: 'message.done',
      messageId: 'done-a',
      role: 'agent',
      payload: { messageId: 'done-a' },
    })
    eventStore.append(session.id, {
      type: 'message.chunk',
      messageId: 'msg-b',
      role: 'agent',
      payload: { messageId: 'msg-b', role: 'agent', contentDelta: 'inspect' },
    })
    eventStore.append(session.id, {
      type: 'tool.call',
      messageId: 'msg-b',
      role: 'agent',
      payload: { messageId: 'msg-b', toolCall: { id: 'tool-b', title: 'Read file' } },
    })
    eventStore.append(session.id, {
      type: 'message.done',
      messageId: 'done-b',
      role: 'agent',
      payload: { messageId: 'done-b' },
    })

    const events = eventStore.listByMessage(session.id, 'msg-b')

    expect(events.map((event) => event.type)).toEqual(['message.chunk', 'tool.call', 'message.done'])
    expect(events.map((event) => event.message_id)).toEqual(['msg-b', 'msg-b', 'done-b'])
    expect(JSON.parse(events[2].payload_json).messageId).toBe('done-b')
  })

  test('returns all selected message events when the turn has no done event', () => {
    const session = sessionStore.create({ agentId: 'agent-message-events-open' })
    eventStore.append(session.id, {
      type: 'message.chunk',
      messageId: 'msg-open',
      role: 'agent',
      payload: { messageId: 'msg-open', role: 'agent', contentDelta: 'inspect' },
    })
    eventStore.append(session.id, {
      type: 'tool.call',
      messageId: 'msg-open',
      role: 'agent',
      payload: { messageId: 'msg-open', toolCall: { id: 'tool-open', title: 'Read file' } },
    })
    eventStore.append(session.id, {
      type: 'message.chunk',
      messageId: 'msg-other',
      role: 'agent',
      payload: { messageId: 'msg-other', role: 'agent', contentDelta: 'other' },
    })

    const events = eventStore.listByMessage(session.id, 'msg-open')

    expect(events.map((event) => event.type)).toEqual(['message.chunk', 'tool.call'])
    expect(events.map((event) => event.message_id)).toEqual(['msg-open', 'msg-open'])
  })

})
