import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionStore, eventStore } from '../../src/store/sessions.js'
import { mergeToolCall } from '../../src/core/tool-calls.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-events-'))
beforeAll(() => { mkdirSync(tmp, { recursive: true }); initDatabase(resolve(tmp, 'test.sqlite')) })
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('eventStore', () => {
  test('追加和查询事件', () => {
    const session = sessionStore.create({ agentId: 'agent-test' })
    const first = eventStore.append(session.id, {
      type: 'plan.update', role: 'system',
      payload: { plan: [{ content: '确认需求', status: 'in_progress', priority: 'medium' }] },
    })
    const second = eventStore.append(session.id, {
      type: 'usage.update',
      payload: { usage: { contextSize: 1000, contextUsed: 123 } },
    })
    const events = eventStore.list(session.id)
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe(first.id)
    expect(events[1].id).toBe(second.id)
    expect(JSON.parse(events[0].payload_json).plan[0].content).toBe('确认需求')
    expect(events[0].sequence).toBeLessThan(events[1].sequence)
  })
})

describe('mergeToolCall', () => {
  test('增量合并 terminalOutput 和 progress', () => {
    const merged = mergeToolCall(
      { id: 'tool-1', title: '运行测试', kind: 'execute', status: 'in_progress', terminalOutput: 'a', progress: ['开始'] },
      { id: 'tool-1', title: '', terminalOutputDelta: 'b', progressDelta: '继续', status: 'completed' },
    )
    expect(merged.title).toBe('运行测试')
    expect(merged.terminalOutput).toBe('ab')
    expect(merged.progress).toEqual(['开始', '继续'])
    expect(merged.status).toBe('completed')
  })
})
