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
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-mock-mainline-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(async () => {
  for (const agentId of acpHost.listRunning()) await acpHost.stopAgent(agentId)
  await new Promise((resolve) => setTimeout(resolve, 100))
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('mock chat mainline', () => {
  test('persists streaming chunks before a single done event', async () => {
    const agent = agentStore.create({ name: 'Mock 主链路', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    await sessionManager.sendPrompt(session.id, 'hello mainline')

    const events = await waitForCompletedTurn(session.id)
    const chunkEvents = events.filter((event) => event.type === 'message.chunk')
    const doneEvents = events.filter((event) => event.type === 'message.done')

    expect(chunkEvents.length).toBeGreaterThan(0)
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].sequence).toBeGreaterThan(chunkEvents.at(-1)!.sequence)
  }, 10_000)
})

async function waitForCompletedTurn(sessionId: string) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const events = eventStore.list(sessionId)
    const chunkEvents = events.filter((event) => event.type === 'message.chunk')
    const doneEvents = events.filter((event) => event.type === 'message.done')
    if (chunkEvents.length > 0 && doneEvents.some((done) => done.sequence > chunkEvents.at(-1)!.sequence)) return events
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return eventStore.list(sessionId)
}
