import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { events, type AppEvents } from '../../src/core/events.js'
import { handleRuntimeAgentStatus } from '../../src/runtime/api/runtime-ingress.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-runtime-status-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Runtime Agent status ingress', () => {
  test('persists and publishes a changed status exactly once', () => {
    const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock' })
    const received: AppEvents['agent:status'][] = []
    const listener = (event: AppEvents['agent:status']): void => { received.push(event) }
    events.on('agent:status', listener)

    try {
      handleRuntimeAgentStatus({ agentId: agent.id, status: 'running' })
      handleRuntimeAgentStatus({ agentId: agent.id, status: 'running' })

      expect(agentStore.get(agent.id)?.status).toBe('running')
      expect(received).toEqual([{ agentId: agent.id, status: 'running' }])
    } finally {
      events.off('agent:status', listener)
    }
  })
})
