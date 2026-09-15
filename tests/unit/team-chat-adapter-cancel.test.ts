import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationAdapter } from '../../ui/src/components/chat/conversation-types'
import { createTeamChatAdapter } from '../../ui/src/components/team/team-chat-adapter'

vi.mock('../../ui/src/services/command-client', () => ({
  commandClient: { execute: vi.fn(async () => ({ commandId: 'x', status: 'completed' as const, duplicate: false })) },
}))

import { commandClient } from '../../ui/src/services/command-client'
const execute = vi.mocked(commandClient.execute)

function adapterWith(runningTurnSessionIds: string[], masterSessionId = 'master'): ConversationAdapter {
  return createTeamChatAdapter({
    team: { id: 'team-1', project_id: 'proj-1', name: '团队' } as never,
    conversation: null,
    masterSessionId,
    aggregate: { messages: [], events: [], streaming: [], running: false, hasMore: false, permissions: [], elicitations: [], capabilities: null, usage: null } as never,
    snapshots: {}, loading: false, error: null, sending: false, loadingOlder: false, contentRevision: 0,
    processByMessageId: {}, fileChanges: {}, fileErrors: {},
    processItemLoadingByKey: {}, processItemErrorByKey: {},
    loadMessageProcess: async () => undefined, loadFileChanges: async () => undefined, loadProcessItemDetail: async () => undefined,
    sendPrompt: async () => undefined, loadOlderMessages: async () => undefined,
    reload: async () => true,
    runningTurnSessionIds,
  })
}

const cancelledSessions = (): string[] => execute.mock.calls.map(([command]) => command.type === 'session.cancel' ? command.sessionId : '')

beforeEach(() => { execute.mockClear() })

describe('team adapter main-stop fan-out', () => {
  it('fans out session.cancel to the leader first and every running member', async () => {
    await adapterWith(['master', 's2', 's3']).cancel()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(cancelledSessions()).toEqual(['master', 's2', 's3'])
    expect(execute.mock.calls.every(([command]) => command.type === 'session.cancel')).toBe(true)
  })

  it('does not send a cancel for the leader when it is idle', async () => {
    await adapterWith(['s2', 's3']).cancel()
    expect(cancelledSessions()).toEqual(['s2', 's3'])
    expect(cancelledSessions()).not.toContain('master')
  })

  it('is a no-op when nothing is running', async () => {
    await adapterWith([]).cancel()
    expect(execute).not.toHaveBeenCalled()
  })

  it('swallows a member cancel failure (the turn may have finished on its own)', async () => {
    execute.mockImplementation(async (command) => {
      if (command.type === 'session.cancel' && command.sessionId === 's2') throw new Error('member cancel failed')
      return { commandId: command.commandId, status: 'completed', duplicate: false }
    })
    await expect(adapterWith(['master', 's2', 's3']).cancel()).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('rethrows when the leader cancel fails so the composer shows the stop error', async () => {
    execute.mockImplementation(async (command) => {
      if (command.type === 'session.cancel' && command.sessionId === 'master') throw new Error('leader cancel failed')
      return { commandId: command.commandId, status: 'completed', duplicate: false }
    })
    await expect(adapterWith(['master', 's2']).cancel()).rejects.toThrow('leader cancel failed')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
