import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionRpcHandlers } from '../../src/gateway/rpc/sessions.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import type { RpcContext, RpcHandlerMap } from '../../src/gateway/rpc/types.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-bulk-'))
  initDatabase(resolve(tempDir, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('sessions.bulkAction RPC', () => {
  test('marks only sessions in the requested Agent and project as read', async () => {
    const target = sessionStore.create({ agentId: 'agent-a', projectId: 'project-a' })
    const otherProject = sessionStore.create({ agentId: 'agent-a', projectId: 'project-b' })
    const otherAgent = sessionStore.create({ agentId: 'agent-b', projectId: 'project-a' })
    sessionStore.touch(target.id, '2026-08-30T12:00:00.000Z')
    sessionStore.touch(otherProject.id, '2026-08-30T12:00:00.000Z')
    sessionStore.touch(otherAgent.id, '2026-08-30T12:00:00.000Z')
    const targetBefore = sessionStore.get(target.id)?.last_read_at
    const otherProjectBefore = sessionStore.get(otherProject.id)?.last_read_at
    const otherAgentBefore = sessionStore.get(otherAgent.id)?.last_read_at

    const result = await callRpc(sessionRpcHandlers, 'sessions.bulkAction', {
      action: 'markRead',
      agentId: 'agent-a',
      projectId: 'project-a',
      sessionIds: [target.id, otherProject.id, otherAgent.id],
    }) as { succeeded: string[]; skipped: Array<{ sessionId: string; reason: string }> }

    expect(result.succeeded).toEqual([target.id])
    expect(result.skipped).toHaveLength(2)
    expect(sessionStore.get(target.id)?.last_read_at).not.toBe(targetBefore)
    expect(sessionStore.get(otherProject.id)?.last_read_at).toBe(otherProjectBefore)
    expect(sessionStore.get(otherAgent.id)?.last_read_at).toBe(otherAgentBefore)
  })

  test('does not delete primary or running sessions', async () => {
    const primary = sessionStore.create({ agentId: 'agent-a', projectId: 'project-a', isPrimary: true })
    const running = sessionStore.create({ agentId: 'agent-a', projectId: 'project-a' })
    const idle = sessionStore.create({ agentId: 'agent-a', projectId: 'project-a' })
    messageStore.append(running.id, { role: 'agent', content: '执行中', status: 'running' })
    const deleteSession = vi.spyOn(sessionManager, 'deleteSession').mockResolvedValue()

    const result = await callRpc(sessionRpcHandlers, 'sessions.bulkAction', {
      action: 'delete',
      agentId: 'agent-a',
      projectId: 'project-a',
      sessionIds: [primary.id, running.id, idle.id],
    }) as { succeeded: string[]; skipped: Array<{ sessionId: string; reason: string }> }

    expect(result.succeeded).toEqual([idle.id])
    expect(result.skipped.map((item) => item.sessionId)).toEqual([primary.id, running.id])
    expect(deleteSession).toHaveBeenCalledTimes(1)
    expect(deleteSession).toHaveBeenCalledWith(idle.id)
  })

  test('does not batch-operate on an autonomy session', async () => {
    const autonomy = sessionStore.create({ agentId: 'agent-a', projectId: 'project-a', purpose: 'autonomy' })
    const result = await callRpc(sessionRpcHandlers, 'sessions.bulkAction', {
      action: 'markRead',
      agentId: 'agent-a',
      projectId: 'project-a',
      sessionIds: [autonomy.id],
    }) as { succeeded: string[]; skipped: Array<{ sessionId: string; reason: string }> }

    expect(result.succeeded).toEqual([])
    expect(result.skipped).toEqual([{ sessionId: autonomy.id, reason: '系统会话不可批量操作' }])
  })
})

async function callRpc(
  handlers: RpcHandlerMap,
  type: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  let result: unknown
  let error: string | null = null
  const context: RpcContext = {
    state: { subscriptions: new Set(), authMode: 'owner' },
    sendResult: (data) => { result = data },
    sendError: (message) => { error = message },
    sendOutOfBandError: (message) => { error = message },
  }
  await handlers[type]({ type, ...input } as never, context)
  if (error) throw new Error(error)
  return result
}
