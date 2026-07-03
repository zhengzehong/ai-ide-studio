import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { hubClient } from '../../src/core/agent-hub/hub-client.js'
import { handleInboundTask, type HubConnection } from '../../src/core/agent-hub/task-relay.js'
import { resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'
import type { TaskEventData } from '../../src/core/agent-hub/sse-client.js'
import type { SseClient } from '../../src/core/agent-hub/sse-client.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-hub-task-relay-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  resetCachedMachineIdForTest()
})

afterEach(() => {
  resetCachedMachineIdForTest()
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function buildConn(sessionId: string, agentId: string): HubConnection {
  return {
    sessionId,
    agentId,
    projectId: null,
    hubUrl: 'http://hub.test',
    providerToken: 'provider-token',
    callerToken: 'caller-token',
    internalToken: 'internal-token',
    registrationId: 'reg-1',
    hubAgentId: 'h-me',
    machineId: 'machine-1',
    sseClient: {} as SseClient,
    outboundTasks: new Map(),
    inboundTasks: new Map(),
    contextSessionMap: new Map(),
    doneListeners: new Map(),
    agentCache: new Map(),
  }
}

function buildTaskEventData(): TaskEventData {
  return {
    message: {
      messageId: 'msg-source',
      contextId: 'ctx-1',
      role: 'ROLE_USER',
      parts: [{ type: 'text', text: '帮我审合同', mediaType: 'text/plain' }],
    },
    configuration: {
      taskPushNotificationConfig: {
        url: 'http://hub.test/push',
        authentication: { credentials: 'push-token' },
      },
    },
    metadata: {
      hubTaskId: 'hub-task-1',
      sourceHubAgentId: 'h-source',
    },
  }
}

describe('handleInboundTask createSession 失败回传 FAILED', () => {
  test('createSession 抛错时立即 pushResult FAILED 状态并 return', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    const createSpy = vi
      .spyOn(sessionManager, 'createSession')
      .mockRejectedValue(new Error('db locked'))
    const searchSpy = vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const pushSpy = vi.spyOn(hubClient, 'pushResult').mockResolvedValue(undefined)

    const enqueueSpy = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    await handleInboundTask(conn, buildTaskEventData())

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(enqueueSpy).not.toHaveBeenCalled()

    const [pushUrl, pushToken, payload] = pushSpy.mock.calls[0]
    expect(pushUrl).toBe('http://hub.test/push')
    expect(pushToken).toBe('push-token')
    const result = payload as {
      task: {
        id: string
        contextId: string
        status: { state: string; message: { parts: Array<{ type: string; text: string }> } }
      }
    }
    expect(result.task.id).toBe('hub-task-1')
    expect(result.task.contextId).toBe('ctx-1')
    expect(result.task.status.state).toBe('TASK_STATE_FAILED')
    expect(result.task.status.message.parts[0].text).toContain('本地 session 创建失败')
    expect(result.task.status.message.parts[0].text).toContain('db locked')

    expect(conn.inboundTasks.has('hub-task-1')).toBe(false)
    expect(conn.contextSessionMap.has('ctx-1')).toBe(false)
    expect(searchSpy).not.toHaveBeenCalled()
  })

  test('createSession 抛错后 pushResult 也失败时不抛出,静默 return', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    vi.spyOn(sessionManager, 'createSession').mockRejectedValue(new Error('db locked'))
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const pushSpy = vi
      .spyOn(hubClient, 'pushResult')
      .mockRejectedValue({ status: 500, body: null, message: 'hub down' })

    await expect(handleInboundTask(conn, buildTaskEventData())).resolves.toBeUndefined()
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  test('createSession 成功时不触发 FAILED 回传,走正常流程', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    const newSession = sessionStore.create({ agentId: agent.id })
    vi.spyOn(sessionManager, 'createSession').mockResolvedValue(newSession)
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const pushSpy = vi.spyOn(hubClient, 'pushResult').mockResolvedValue(undefined)
    const enqueueSpy = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    await handleInboundTask(conn, buildTaskEventData())

    expect(pushSpy).not.toHaveBeenCalled()
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    expect(conn.inboundTasks.has('hub-task-1')).toBe(true)
    expect(conn.contextSessionMap.get('ctx-1')).toBe(newSession.id)
  })
})
