import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { sessionManager } from '../../src/core/sessions.js'
import { taskRpcHandlers } from '../../src/gateway/rpc/tasks.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskAttachmentStore } from '../../src/store/tasks.js'

const PNG_BASE64 = 'iVBORw0KGgo='

let tmp: string
let originalEnqueuePrompt: typeof sessionManager.enqueuePrompt

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-task-image-attachments-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  originalEnqueuePrompt = sessionManager.enqueuePrompt
})

afterEach(() => {
  sessionManager.enqueuePrompt = originalEnqueuePrompt
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('task image attachments', () => {
  test('tasks.create persists images and dispatches path notes plus image blocks', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Target', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    let enqueued: { sessionId: string; content: string; images?: Array<{ data: string; mimeType: string; name?: string }> } | null = null

    sessionManager.enqueuePrompt = (async (sessionId, content, images) => {
      enqueued = { sessionId, content, images }
    }) as typeof sessionManager.enqueuePrompt

    const created = await callTaskRpc('tasks.create', {
      type: 'tasks.create',
      title: '整理截图',
      description: '把截图加入周报',
      projectId: project.id,
      assignAgentId: agent.id,
      sessionId: session.id,
      images: [{ data: PNG_BASE64, mimeType: 'image/png', name: 'task.png' }],
    }) as Record<string, unknown>

    const attachments = taskAttachmentStore.list(created.id as string)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ task_id: created.id, mime_type: 'image/png', name: 'task.png', sort_order: 1 })
    expect(attachments[0].relative_path).toMatch(new RegExp(`^images/tasks/${project.id}/${created.id}/001-`))
    expect(existsSync(attachments[0].absolute_path)).toBe(true)

    expect(enqueued).toMatchObject({ sessionId: session.id })
    expect(enqueued?.content).toContain('整理截图')
    expect(enqueued?.content).toContain('[附件说明]')
    expect(enqueued?.content).toContain(attachments[0].absolute_path)
    expect(enqueued?.images).toEqual([{ data: PNG_BASE64, mimeType: 'image/png', name: 'task.png' }])
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
