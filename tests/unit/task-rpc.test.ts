import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { events } from '../../src/core/events.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { taskStore } from '../../src/store/tasks.js'
import { taskRpcHandlers } from '../../src/gateway/rpc/tasks.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-rpc-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('task RPC handlers', () => {
  test('tasks.update emits one realtime update when only status and stage change', async () => {
    const task = taskStore.create({ title: 'Update once' })
    const updates: Array<{ taskId: string; data: Record<string, unknown> }> = []
    const handler = (ev: { taskId: string; data: Record<string, unknown> }) => updates.push(ev)
    events.on('task:update', handler)

    try {
      await callTaskRpc('tasks.update', {
        type: 'tasks.update',
        taskId: task.id,
        status: 'executing',
        stage: 'Running',
      })
    } finally {
      events.off('task:update', handler)
    }

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      taskId: task.id,
      data: { id: task.id, status: 'executing', stage: 'Running', event: 'updated' },
    })
  })
})

async function callTaskRpc(type: string, msg: Record<string, unknown>): Promise<unknown> {
  let result: unknown
  await taskRpcHandlers[type](
    msg as never,
    {
      state: { subscriptions: new Set() },
      sendResult: (data) => {
        result = data
      },
      sendError: (message) => {
        throw new Error(message)
      },
      sendOutOfBandError: (message) => {
        throw new Error(message)
      },
    },
  )
  return result
}
