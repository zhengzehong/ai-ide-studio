import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, eventStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { acpHost } from '../../src/acp/host.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-prompt-lock-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('sessionManager prompt lifecycle', () => {
  test('同一 Local Session 的并发 prompt 只允许一条进入 ACP', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    let promptResolve!: () => void
    const promptStarted = new Promise<void>((resolve) => { promptResolve = resolve })
    let promptCount = 0

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-existing') as typeof acpHost.ensureSession
    acpHost.prompt = (async () => {
      promptCount += 1
      await promptStarted
    }) as typeof acpHost.prompt

    try {
      const first = sessionManager.sendPrompt(session.id, 'first')
      await expect(sessionManager.sendPrompt(session.id, 'second')).rejects.toThrow('当前会话正在生成中')
      promptResolve()
      await first

      expect(promptCount).toBe(1)
      const userEvents = eventStore.list(session.id).filter(event => event.type === 'message.user')
      expect(userEvents).toHaveLength(1)
      expect(JSON.parse(userEvents[0].payload_json).content).toBe('first')
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })
})
