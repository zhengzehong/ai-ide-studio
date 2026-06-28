import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { events } from '../../src/core/events.js'
import { acpHost } from '../../src/acp/host.js'
import type { SessionActivityData } from '../../src/types/ws-protocol.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-activity-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session activity events', () => {
  test('emits running and idle around a successful prompt', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    const seen: SessionActivityData[] = []
    const onActivity = (ev: SessionActivityData) => seen.push(ev)
    events.on('session:activity', onActivity)

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-existing') as typeof acpHost.ensureSession
    acpHost.prompt = (async () => undefined) as typeof acpHost.prompt

    try {
      await sessionManager.sendPrompt(session.id, 'hello')

      expect(seen.map((item) => `${item.state}:${item.reason}`)).toEqual([
        'running:prompt-started',
        'idle:prompt-done',
      ])
      expect(seen[0]).toMatchObject({ sessionId: session.id, agentId: agent.id })
      expect(seen[1]).toMatchObject({ sessionId: session.id, agentId: agent.id })
      expect(seen[0].timestamp).toBeTruthy()
    } finally {
      events.off('session:activity', onActivity)
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })

  test('emits idle with prompt-error when the prompt fails', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    const seen: SessionActivityData[] = []
    const onActivity = (ev: SessionActivityData) => seen.push(ev)
    events.on('session:activity', onActivity)

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-existing') as typeof acpHost.ensureSession
    acpHost.prompt = (async () => {
      throw new Error('adapter failed')
    }) as typeof acpHost.prompt

    try {
      await expect(sessionManager.sendPrompt(session.id, 'hello')).rejects.toThrow('adapter failed')

      expect(seen.map((item) => `${item.state}:${item.reason}`)).toEqual([
        'running:prompt-started',
        'idle:prompt-error',
      ])
    } finally {
      events.off('session:activity', onActivity)
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })
})
