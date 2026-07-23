import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-message-presentations-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('message preview presentations', () => {
  test('persists a lightweight preview summary without retaining the tool payload', () => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const previewOutput = {
      previewId: 'prev-123',
      url: '/preview/prev-123/',
      title: 'Dashboard preview',
      target: 'pc',
      taskId: 'task-1',
      createdAt: '2026-07-23T00:00:00.000Z',
    }

    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{
        id: 'tool-preview',
        title: 'mcp__ai-ide-tools__preview_publish',
        status: 'completed',
        rawOutput: [{ type: 'text', text: JSON.stringify(previewOutput) }],
      }],
    }) as unknown as { presentations_json?: string | null }

    expect(JSON.parse(row.presentations_json || '[]')).toEqual([{
      kind: 'preview',
      ...previewOutput,
    }])
  })

  test.each([
    {
      title: 'preview.publish',
      status: 'failed',
      rawOutput: JSON.stringify({ previewId: 'prev-failed', title: 'Failed', target: 'pc', createdAt: '2026-07-23T00:00:00.000Z' }),
    },
    {
      title: 'preview.publish',
      status: 'completed',
      rawOutput: JSON.stringify({ error: 'publish failed' }),
    },
    {
      title: 'other.tool',
      status: 'completed',
      rawOutput: JSON.stringify({ previewId: 'prev-other', title: 'Other', target: 'pc', createdAt: '2026-07-23T00:00:00.000Z' }),
    },
  ])('does not persist invalid or unsuccessful preview output %#', (toolCall) => {
    const session = sessionStore.create({ agentId: 'agent-1' })
    const row = messageStore.append(session.id, {
      role: 'agent',
      content: 'Done',
      toolCalls: [{ id: 'tool-preview', ...toolCall }],
    }) as unknown as { presentations_json?: string | null }

    expect(row.presentations_json ?? null).toBeNull()
  })
})

