import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { hubClient } from '../../src/core/agent-hub/hub-client.js'
import {
  handleInboundTask,
  type HubConnection,
} from '../../src/core/agent-hub/task-relay.js'
import { resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'
import { events } from '../../src/core/events.js'
import type { TaskEventData } from '../../src/core/agent-hub/sse-client.js'
import type { SseClient } from '../../src/core/agent-hub/sse-client.js'
import type { SessionDoneData } from '../../src/types/ws-protocol.js'

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

describe('handleInboundTask 复用 connect 会话(P1-A)', () => {
  test('inbound task 复用 conn.sessionId,不调 createSession', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    const createSpy = vi.spyOn(sessionManager, 'createSession')
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    vi.spyOn(hubClient, 'pushResult').mockResolvedValue(undefined)
    const enqueueSpy = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    await handleInboundTask(conn, buildTaskEventData())

    expect(createSpy).not.toHaveBeenCalled()
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    expect(enqueueSpy.mock.calls[0][0]).toBe(session.id)
    expect(conn.contextSessionMap.get('ctx-1')).toBe(session.id)
    expect(conn.inboundTasks.get('hub-task-1')?.localSessionId).toBe(session.id)
  })

  test('多轮 contextId 复用同一 localSessionId', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    vi.spyOn(sessionManager, 'createSession')
    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    vi.spyOn(hubClient, 'pushResult').mockResolvedValue(undefined)
    const enqueueSpy = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    await handleInboundTask(conn, buildTaskEventData())
    await handleInboundTask(conn, buildTaskEventData())

    expect(enqueueSpy).toHaveBeenCalledTimes(2)
    expect(enqueueSpy.mock.calls[0][0]).toBe(session.id)
    expect(enqueueSpy.mock.calls[1][0]).toBe(session.id)
    expect(conn.contextSessionMap.get('ctx-1')).toBe(session.id)
  })
})

describe('handleInboundTask doneHandler 时序(P1-B)', () => {
  test('doneHandler 在 enqueuePrompt 之前注册,session:done 能被捕获', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    vi.spyOn(hubClient, 'pushResult').mockResolvedValue(undefined)

    // 模拟 enqueuePrompt 阻塞到 prompt 完成,session:done 在期间 emit
    vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(
      async (_sid: string, _content: string): Promise<void> => {
        const doneData: SessionDoneData = {
          sessionId: session.id,
          agentId: agent.id,
          messageId: 'msg-done',
          turnId: 'turn-1',
          stopReason: 'stop',
        }
        events.emit('session:done', doneData)
      },
    )

    await handleInboundTask(conn, buildTaskEventData())

    // doneHandler 触发后从 doneListeners 移除
    expect(conn.doneListeners.has('hub-task-1')).toBe(false)
    // relayResultBack 成功后 inboundTask 被清理
    expect(conn.inboundTasks.has('hub-task-1')).toBe(false)
  })

  test('enqueuePrompt 失败时回传 FAILED 并清理 doneHandler', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const pushSpy = vi.spyOn(hubClient, 'pushResult').mockResolvedValue(undefined)
    vi.spyOn(sessionManager, 'enqueuePrompt').mockRejectedValue(new Error('acp boom'))

    await handleInboundTask(conn, buildTaskEventData())

    expect(pushSpy).toHaveBeenCalledTimes(1)
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
    expect(result.task.status.message.parts[0].text).toContain('enqueuePrompt 失败')
    expect(result.task.status.message.parts[0].text).toContain('acp boom')

    expect(conn.doneListeners.has('hub-task-1')).toBe(false)
    expect(conn.inboundTasks.has('hub-task-1')).toBe(false)
  })

  test('enqueuePrompt 失败后 pushResult 也失败时不抛出,静默 return', async () => {
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const conn = buildConn(session.id, agent.id)

    vi.spyOn(hubClient, 'search').mockResolvedValue([])
    const pushSpy = vi
      .spyOn(hubClient, 'pushResult')
      .mockRejectedValue({ status: 500, body: null, message: 'hub down' })
    vi.spyOn(sessionManager, 'enqueuePrompt').mockRejectedValue(new Error('acp boom'))

    await expect(handleInboundTask(conn, buildTaskEventData())).resolves.toBeUndefined()
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(conn.doneListeners.has('hub-task-1')).toBe(false)
    expect(conn.inboundTasks.has('hub-task-1')).toBe(false)
  })
})
