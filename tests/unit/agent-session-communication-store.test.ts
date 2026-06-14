import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentSessionMessageStore, agentSessionWatchStore } from '../../src/store/agent-session-communication.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-session-comm-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent session communication stores', () => {
  test('creates messages and marks needReply as satisfied by reverse response', () => {
    const request = agentSessionMessageStore.create({
      projectId: 'project-a',
      sourceAgentId: 'agent-a',
      sourceSessionId: 'sess-a',
      targetAgentId: 'agent-b',
      targetSessionId: 'sess-b',
      content: 'please check',
      relatedInfo: { issue_id: 'ISSUE-1' },
      needReply: true,
    })
    const response = agentSessionMessageStore.create({
      projectId: 'project-a',
      sourceAgentId: 'agent-b',
      sourceSessionId: 'sess-b',
      targetAgentId: 'agent-a',
      targetSessionId: 'sess-a',
      content: 'done',
      relatedInfo: { issue_id: 'ISSUE-1' },
      needReply: false,
    })

    const satisfied = agentSessionMessageStore.markLatestReplySatisfiedByResponse(response)

    expect(request.need_reply).toBe(1)
    expect(satisfied?.id).toBe(request.id)
    expect(agentSessionMessageStore.get(request.id)?.reply_satisfied_at).toEqual(expect.any(String))
  })

  test('lists unresolved needReply messages and marks reminder sent once', () => {
    const message = agentSessionMessageStore.create({
      projectId: 'project-a',
      sourceAgentId: 'agent-a',
      sourceSessionId: 'sess-a',
      targetAgentId: 'agent-b',
      targetSessionId: 'sess-b',
      content: 'please reply',
      relatedInfo: {},
      needReply: true,
    })

    expect(agentSessionMessageStore.listPendingRepliesForTargetSession('sess-b').map((row) => row.id)).toEqual([message.id])

    const reminded = agentSessionMessageStore.markReminderSent(message.id)

    expect(reminded?.reply_reminder_count).toBe(1)
    expect(agentSessionMessageStore.listPendingRepliesForTargetSession('sess-b')).toHaveLength(0)
  })

  test('creates active watch and marks once watch triggered', () => {
    const watch = agentSessionWatchStore.create({
      projectId: 'project-a',
      watcherAgentId: 'agent-a',
      watcherSessionId: 'sess-a',
      watchedAgentId: 'agent-b',
      watchedSessionId: 'sess-b',
      relatedInfo: { event_id: 'evt-1' },
      once: true,
    })

    expect(agentSessionWatchStore.listActiveByWatchedSession('sess-b').map((row) => row.id)).toEqual([watch.id])

    const triggered = agentSessionWatchStore.markTriggered(watch.id, {
      messageId: 'msg-b',
      turnId: 'turn-b',
      once: true,
    })

    expect(triggered?.status).toBe('triggered')
    expect(triggered?.trigger_count).toBe(1)
    expect(agentSessionWatchStore.listActiveByWatchedSession('sess-b')).toHaveLength(0)
  })
})
