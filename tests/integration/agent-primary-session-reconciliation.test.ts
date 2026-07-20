import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  reconcileAgentPrimarySessions,
  seedDefaultAgents,
} from '../../src/core/agent-primary-sessions.js'
import { events } from '../../src/core/events.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore, type SessionRow } from '../../src/store/sessions.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-primary-session-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Agent primary Session reconciliation', () => {
  test('gives every default Agent exactly one primary Session on a fresh database', () => {
    const published: SessionRow[] = []
    const listener = (event: { data?: unknown }) => published.push(event.data as SessionRow)
    events.on('session:changed', listener)
    try {
      seedDefaultAgents()
      const first = reconcileAgentPrimarySessions()
      const second = reconcileAgentPrimarySessions()

      expect(first.created).toHaveLength(3)
      expect(second.created).toEqual([])
      expect(agentStore.list()).toHaveLength(3)
      for (const agent of agentStore.list()) {
        expect(sessionStore.list(agent.id).filter((session) => session.is_primary === 1)).toHaveLength(1)
      }
      expect(published.map((session) => session.agent_id).sort())
        .toEqual(['claude-dev', 'codex-dev', 'mock-dev'])
    } finally {
      events.off('session:changed', listener)
    }
  })

  test('adds one primary Session to an existing Agent without replacing its history', () => {
    const agent = agentStore.create({ id: 'agent-existing', name: 'Existing', type: 'dev', runtime: 'mock' })
    const history = sessionStore.create({ agentId: agent.id, title: 'Existing history' })

    reconcileAgentPrimarySessions()
    reconcileAgentPrimarySessions()

    const sessions = sessionStore.list(agent.id)
    expect(sessions.some((session) => session.id === history.id)).toBe(true)
    expect(sessions.filter((session) => session.is_primary === 1)).toHaveLength(1)
    expect(sessions).toHaveLength(2)
  })
})
