import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-runtime-prefs-'))
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

describe('session runtime preferences', () => {
  test('persists model, mode, and config choices independently', () => {
    const agent = agentStore.create({ name: 'Codex', type: 'dev', runtime: 'codex' })
    const session = sessionStore.create({ agentId: agent.id })

    sessionStore.updateRuntimePreferences(session.id, { modelId: 'gpt-5-codex' })
    sessionStore.updateRuntimePreferences(session.id, { modeId: 'agent-full-access' })
    sessionStore.updateRuntimePreferences(session.id, { config: { effort: 'high' } })
    sessionStore.updateRuntimePreferences(session.id, { config: { webSearch: true } })

    expect(sessionStore.getRuntimePreferences(session.id)).toEqual({
      modelId: 'gpt-5-codex',
      modeId: 'agent-full-access',
      config: {
        effort: 'high',
        webSearch: true,
      },
    })
  })

  test('ignores malformed stored preferences', () => {
    const agent = agentStore.create({ name: 'Claude', type: 'dev', runtime: 'claude' })
    const session = sessionStore.create({ agentId: agent.id })

    getDb().prepare('UPDATE sessions SET runtime_preferences_json = ? WHERE id = ?').run('{bad-json', session.id)

    expect(sessionStore.getRuntimePreferences(session.id)).toEqual({})
  })
})
