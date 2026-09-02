import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore, withParsedTags } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-tags-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function createSession(title: string) {
  const agent = agentStore.create({ type: 'dev', name: `agent-${title}`, runtime: 'mock' })
  return sessionStore.create({ agentId: agent.id })
}

describe('sessionStore tags', () => {
  test('new sessions default to an empty tag list and parsed tags are exposed', () => {
    const session = createSession('默认')
    const loaded = sessionStore.get(session.id)
    expect(loaded?.tags).toEqual([])
  })

  test('setTags persists and parses tags on every read path', () => {
    const session = createSession('读取')
    sessionStore.setTags(session.id, ['调研', 'workbench'])
    expect(sessionStore.get(session.id)?.tags).toEqual(['调研', 'workbench'])
    expect(sessionStore.list(undefined, undefined).find((row) => row.id === session.id)?.tags).toEqual(['调研', 'workbench'])
    expect(sessionStore.listByIds([session.id])[0]?.tags).toEqual(['调研', 'workbench'])
    expect(sessionStore.listWithRuntimeState().find((row) => row.id === session.id)?.tags).toEqual(['调研', 'workbench'])
  })

  test('outbound rows never leak the raw tags_json key', () => {
    const session = createSession('泄漏')
    sessionStore.setTags(session.id, ['安全'])
    for (const row of [
      sessionStore.get(session.id),
      ...sessionStore.list(),
      ...sessionStore.listByIds([session.id]),
      ...sessionStore.listWithRuntimeState(),
    ]) {
      expect(row).toBeDefined()
      expect(Object.keys(row as Record<string, unknown>)).not.toContain('tags_json')
      expect(Array.isArray(row?.tags)).toBe(true)
    }
  })

  test('withParsedTags tolerates malformed tag payloads', () => {
    expect(withParsedTags({
      id: 'sess-x',
      agent_id: 'agent-x',
      task_id: null,
      acp_session_id: null,
      status: 'active',
      stage: '',
      started_at: '2026-01-01T00:00:00.000Z',
      closed_at: null,
      project_id: null,
      title: null,
      updated_at: null,
      last_message_at: null,
      last_read_at: null,
      archived_at: null,
      deleted_at: null,
      runtime_preferences_json: null,
      sort_order: null,
      is_primary: 0,
      is_template: 0,
      purpose: 'conversation',
      tags_json: 'not-json',
    }).tags).toEqual([])
    expect(withParsedTags({
      id: 'sess-x',
      agent_id: 'agent-x',
      task_id: null,
      acp_session_id: null,
      status: 'active',
      stage: '',
      started_at: '2026-01-01T00:00:00.000Z',
      closed_at: null,
      project_id: null,
      title: null,
      updated_at: null,
      last_message_at: null,
      last_read_at: null,
      archived_at: null,
      deleted_at: null,
      runtime_preferences_json: null,
      sort_order: null,
      is_primary: 0,
      is_template: 0,
      purpose: 'conversation',
      tags_json: JSON.stringify(['重复', '重复', 42, '  ', '去空格 ']),
    }).tags).toEqual(['重复', '去空格'])
  })
})

describe('sessionStore restore', () => {
  test('restoring clears archived_at and makes the session visible again', () => {
    const session = createSession('归档还原')
    const archived = sessionManager.archiveSession(session.id)
    expect(archived.archived_at).not.toBeNull()
    expect(sessionStore.list().find((row) => row.id === session.id)?.archived_at).not.toBeNull()

    const restored = sessionManager.restoreSession(session.id)
    expect(restored.archived_at).toBeNull()
    expect(sessionStore.get(session.id)?.archived_at).toBeNull()
    expect(sessionStore.list().find((row) => row.id === session.id)?.archived_at).toBeNull()
  })

  test('restore rejects sessions that are not archived', () => {
    const session = createSession('未归档')
    expect(() => sessionManager.restoreSession(session.id)).toThrow('会话未归档')
  })
})
