import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { eventStore, sessionStore } from '../../src/store/sessions.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-recovery-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('session interrupted stage recovery', () => {
  test('marks active open turns interrupted and closes their event stream', () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const interrupted = sessionStore.create({ agentId: agent.id })
    const completed = sessionStore.create({ agentId: agent.id })
    const closed = sessionStore.create({ agentId: agent.id })

    sessionStore.updateStage(interrupted.id, '正在思考...')
    eventStore.append(interrupted.id, {
      type: 'message.user',
      agentId: agent.id,
      messageId: 'user-open',
      role: 'human',
      payload: { messageId: 'user-open', content: 'hello' },
    })

    sessionStore.updateStage(completed.id, '正在思考...')
    eventStore.append(completed.id, {
      type: 'message.user',
      agentId: agent.id,
      messageId: 'user-done',
      role: 'human',
      payload: { messageId: 'user-done', content: 'done' },
    })
    eventStore.append(completed.id, {
      type: 'message.done',
      agentId: agent.id,
      messageId: 'done-existing',
      role: 'agent',
      payload: { messageId: 'done-existing', stopReason: 'end_turn' },
    })

    sessionStore.updateStage(closed.id, '正在思考...')
    sessionStore.updateStatus(closed.id, 'closed')

    const result = sessionStore.reconcileInterruptedStages()

    expect(result.interrupted.map((s) => s.id)).toEqual([interrupted.id])
    expect(result.cleared.map((s) => s.id).sort()).toEqual([closed.id, completed.id].sort())
    expect(sessionStore.get(interrupted.id)?.stage).toBe('生成已中断，可重新发送')
    expect(sessionStore.get(completed.id)?.stage).toBe('')
    expect(sessionStore.get(closed.id)?.stage).toBe('')

    const doneEvents = eventStore.list(interrupted.id).filter((event) => event.type === 'message.done')
    expect(doneEvents).toHaveLength(1)
    expect(JSON.parse(doneEvents[0].payload_json)).toMatchObject({
      stopReason: 'error',
      error: '服务重启，生成已中断',
    })
  })
})
