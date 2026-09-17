import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AUTONOMOUS_TURN_NOTICE } from '../../src/shared/autonomous-turn.js'
import { events } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { startTurnProcess } from '../../src/core/turn-process-runtime.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-terminal-attr-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

/** session:update 走 actor 调度(setImmediate),等一拍再发终帧。 */
const settleUpdates = (): Promise<void> => new Promise((done) => setTimeout(done, 20))

describe('session done terminal attribution (sess-d83044f2 regression)', () => {
  test('autonomous terminal never lands on the freshly started real turn row', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    // 真回合刚启动:行 + 执行过程都已登记(与事故 03:24:13.3xx 的状态一致)
    const realMessage = messageStore.append(session.id, {
      id: 'msg-turn-real',
      role: 'agent',
      content: '',
      status: 'running',
    })
    startTurnProcess(session.id, realMessage.id)

    // 合成(后台唤醒)回合的内容已聚合在 pending(wakeNotice 旁路)
    events.emit('session:update', {
      sessionId: session.id,
      agentId: agent.id,
      data: { messageId: 'auto-1', role: 'agent', contentDelta: AUTONOMOUS_TURN_NOTICE, wakeNotice: true },
    })
    await settleUpdates()

    // 合成回合被 dispose,终帧携带自己的 auto id
    events.emit('session:done', { sessionId: session.id, agentId: agent.id, messageId: 'auto-1', stopReason: 'end_turn' })
    await sessionManager.waitForPersistence(session.id)

    const autoRow = messageStore.get('auto-1')
    expect(autoRow?.status).toBe('completed')
    expect(autoRow?.content).toBe(AUTONOMOUS_TURN_NOTICE)

    const untouched = messageStore.get(realMessage.id)
    expect(untouched?.status).toBe('running')
    expect(untouched?.content).toBe('')
  })

  test('late terminal recovers the real draft from session events instead of dropping it', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const message = messageStore.append(session.id, {
      id: 'msg-turn-late',
      role: 'agent',
      content: '',
      status: 'running',
    })

    for (const delta of ['聚合带宽实测 ', '87MB/min', ',权重剩约 4.94GB。']) {
      eventStore.append(session.id, {
        type: 'message.chunk',
        agentId: agent.id,
        messageId: message.id,
        role: 'agent',
        payload: { messageId: message.id, role: 'agent', contentDelta: delta },
      })
    }

    // 终帧到达时既没有 pending 聚合也没有活跃过程(内容只在事件流里)
    events.emit('session:done', { sessionId: session.id, agentId: agent.id, messageId: message.id, stopReason: 'cancelled' })
    await sessionManager.waitForPersistence(session.id)

    const finalized = messageStore.get(message.id)
    expect(finalized?.status).toBe('cancelled')
    expect(finalized?.content).toBe('聚合带宽实测 87MB/min,权重剩约 4.94GB。')
  })

  // T1(二审 B1):进程退出终帧携带 exit-* 合成 id(在 messages 表没有对应行)。
  // 修复前:终态写到 exit-* → 真实行僵死 + 幽灵行落库;修复后:归属真实行,不建幽灵行。
  test('B1: process-exit synthetic id terminalizes the real running row and creates no ghost row', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const realMessage = messageStore.append(session.id, {
      id: 'msg-real-turn',
      role: 'agent',
      content: '',
      status: 'running',
    })
    startTurnProcess(session.id, realMessage.id)

    const syntheticId = 'exit-1789608680000'
    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: syntheticId,
      stopReason: 'error',
      error: 'Agent 进程意外退出 (code=1)',
    })
    await sessionManager.waitForPersistence(session.id)

    const real = messageStore.get(realMessage.id)
    expect(real?.status).toBe('failed')
    expect(real?.content).toContain('Agent 进程意外退出')
    // 幽灵行:exit-* 不得在 messages 表落任何行
    expect(messageStore.get(syntheticId)).toBeUndefined()
  })

  test('B1: process-exit terminal keeps the real turn own draft when it is also pending', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const realMessage = messageStore.append(session.id, {
      id: 'msg-real-turn-2',
      role: 'agent',
      content: '',
      status: 'running',
    })
    startTurnProcess(session.id, realMessage.id)
    events.emit('session:update', {
      sessionId: session.id,
      agentId: agent.id,
      data: { messageId: realMessage.id, role: 'agent', contentDelta: '退出前已产出的草稿' },
    })
    await settleUpdates()

    const syntheticId = 'exit-1789608681111'
    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: syntheticId,
      stopReason: 'error',
      error: 'Agent 进程意外退出 (code=1)',
    })
    await sessionManager.waitForPersistence(session.id)

    const real = messageStore.get(realMessage.id)
    expect(real?.status).toBe('failed')
    // 与归属行同源的 pending 聚合内容优先于错误文案(草稿不丢)
    expect(real?.content).toBe('退出前已产出的草稿')
    expect(messageStore.get(syntheticId)).toBeUndefined()
  })

  // 集成契约(tests/integration/session-done-error.test.ts):done 携带 done-<sid> 合成 id、
  // 无活跃过程,唯一内容在流式 pending 聚合 → 终稿必须落到 pending 的真实行。
  test('synthetic done id without active process finalizes the pending streamed row', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    events.emit('session:update', {
      sessionId: session.id,
      agentId: agent.id,
      data: { messageId: 'msg-live-turn-1', role: 'agent', contentDelta: 'hello' },
    })
    await settleUpdates()

    events.emit('session:done', {
      sessionId: session.id,
      agentId: agent.id,
      messageId: `done-${session.id}`,
      stopReason: 'end_turn',
    })
    await sessionManager.waitForPersistence(session.id)

    const persisted = messageStore.get('msg-live-turn-1')
    expect(persisted?.status).toBe('completed')
    expect(persisted?.content).toBe('hello')
    expect(messageStore.get(`done-${session.id}`)).toBeUndefined()
  })

  // T2:迟到重复终帧 + 新聚合内容 —— 行已终态,写守卫必须拦住,内容不被改写(applied=false 路径)。
  test('late duplicate terminal cannot rewrite an already settled row', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const message = messageStore.append(session.id, {
      id: 'msg-late-dup',
      role: 'agent',
      content: '',
      status: 'running',
    })

    events.emit('session:update', {
      sessionId: session.id,
      agentId: agent.id,
      data: { messageId: message.id, role: 'agent', contentDelta: 'first answer' },
    })
    await settleUpdates()
    events.emit('session:done', { sessionId: session.id, agentId: agent.id, messageId: message.id, stopReason: 'end_turn' })
    await sessionManager.waitForPersistence(session.id)
    expect(messageStore.get(message.id)?.status).toBe('completed')
    expect(messageStore.get(message.id)?.content).toBe('first answer')

    events.emit('session:update', {
      sessionId: session.id,
      agentId: agent.id,
      data: { messageId: message.id, role: 'agent', contentDelta: 'late duplicate' },
    })
    await settleUpdates()
    events.emit('session:done', { sessionId: session.id, agentId: agent.id, messageId: message.id, stopReason: 'end_turn' })
    await sessionManager.waitForPersistence(session.id)

    const row = messageStore.get(message.id)
    expect(row?.status).toBe('completed')
    expect(row?.content).toBe('first answer')
  })
})
