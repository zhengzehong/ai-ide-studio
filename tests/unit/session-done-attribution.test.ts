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
})
