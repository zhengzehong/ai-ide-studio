import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import { QUEUED_PROMPT_STAGE } from '../../src/store/session-runtime-state.js'

let tmp: string
let originalEnsureSession: typeof acpHost.ensureSession
let originalPrompt: typeof acpHost.prompt

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-queue-visibility-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  originalEnsureSession = acpHost.ensureSession
  originalPrompt = acpHost.prompt
})

afterEach(() => {
  acpHost.ensureSession = originalEnsureSession
  acpHost.prompt = originalPrompt
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitUntil timeout')
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
}

describe('queued prompt visibility', () => {
  test('a prompt queued behind a busy turn shows the queued stage, then clears on drain', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    acpHost.ensureSession = (async () => 'acp-session') as typeof acpHost.ensureSession
    let releaseTurn: () => void = () => undefined
    const turnGate = new Promise<void>((resolveGate) => {
      releaseTurn = resolveGate
    })
    acpHost.prompt = (async () => {
      await turnGate
    }) as typeof acpHost.prompt

    const first = sessionManager.sendPrompt(session.id, '第一个问题', [], { clientMessageId: 'msg-queue-1' })
    await waitUntil(() => sessionManager.isPromptActive(session.id))

    const second = sessionManager.sendPrompt(session.id, '第二个问题', [], { clientMessageId: 'msg-queue-2' })
    await waitUntil(() => sessionStore.get(session.id)?.stage === QUEUED_PROMPT_STAGE)
    expect(sessionManager.isPromptPending(session.id)).toBe(true)

    releaseTurn()
    await first
    await second
    await waitUntil(() => sessionStore.get(session.id)?.stage !== QUEUED_PROMPT_STAGE)
  })
})
