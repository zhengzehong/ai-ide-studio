import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getDb, initDatabase, closeDatabase } from '../../src/store/db.js'
import { createToolContext, validateToolToken, revokeToolContextBySession } from '../../src/tools/registry/context-registry.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-context-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('tool context registry', () => {
  test('creates a raw token and stores only its hash', () => {
    const { token, context } = createToolContext({
      sessionId: 'sess-1',
      acpSessionId: 'acp-1',
      agentId: 'agent-1',
      projectId: 'proj-1',
      teamId: 'team-1',
      teamMemberId: 'tm-1',
      visibleTools: ['core.task.list'],
      ttlMs: 60_000,
    })

    expect(token.length).toBeGreaterThan(20)
    expect(context.sessionId).toBe('sess-1')
    expect(context.teamId).toBe('team-1')
    expect(context.teamMemberId).toBe('tm-1')
    expect(context.visibleTools).toEqual(['core.task.list'])

    const row = getDb().prepare<[], { token_hash: string }>('SELECT token_hash FROM tool_contexts').get()
    expect(row?.token_hash).toBeTruthy()
    expect(row?.token_hash).not.toBe(token)

    expect(validateToolToken(token)).toMatchObject({
      teamId: 'team-1',
      teamMemberId: 'tm-1',
    })
  })

  test('validates active tokens and rejects revoked or expired tokens', () => {
    const created = createToolContext({
      sessionId: 'sess-2',
      agentId: 'agent-2',
      visibleTools: ['core.task.list', 'core.task.create'],
      ttlMs: 60_000,
    })

    expect(validateToolToken(created.token)).toMatchObject({
      sessionId: 'sess-2',
      agentId: 'agent-2',
      visibleTools: ['core.task.list', 'core.task.create'],
    })

    revokeToolContextBySession('sess-2')
    expect(validateToolToken(created.token)).toBeNull()

    const expired = createToolContext({
      sessionId: 'sess-3',
      agentId: 'agent-3',
      visibleTools: ['core.task.list'],
      ttlMs: -1,
    })
    expect(validateToolToken(expired.token)).toBeNull()
  })
})
