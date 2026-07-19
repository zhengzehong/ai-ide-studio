import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { startApp, type AppHandle } from '../../src/app.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { eventStore, messageStore, sessionStore } from '../../src/store/sessions.js'
import type { RuntimeMode } from '../../src/core/config.js'

let app: AppHandle | undefined
const tempDirs: string[] = []

afterEach(async () => {
  await app?.stop()
  app = undefined
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Runtime command parity', () => {
  test('keeps persisted mock chat semantics in embedded and process modes', async () => {
    const embedded = await runTurn('embedded')
    const process = await runTurn('process')

    expect(normalizeEventTypes(process.eventTypes)).toEqual(normalizeEventTypes(embedded.eventTypes))
    expect(process.messageRoles).toEqual(embedded.messageRoles)
    expect(process.agentStatus).toBe('completed')
  }, 25_000)
})

async function runTurn(runtimeMode: RuntimeMode): Promise<{
  eventTypes: string[]
  messageRoles: string[]
  agentStatus: string | undefined
}> {
  await app?.stop()
  app = undefined
  const dataDir = mkdtempSync(resolve(tmpdir(), `ai-ide-runtime-${runtimeMode}-`))
  tempDirs.push(dataDir)
  app = await startApp({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    runtime: 'web',
    dataWorkerMode: 'local',
    realtimeMode: runtimeMode === 'process' ? 'process' : 'embedded',
    realtimePort: 0,
    runtimeMode,
  })
  const agent = agentStore.create({ name: `${runtimeMode} agent`, type: 'developer', runtime: 'mock' })
  const session = sessionStore.create({ agentId: agent.id })
  await sessionManager.sendPrompt(session.id, 'hello parity')
  await sessionManager.waitForPersistence(session.id)
  const messages = messageStore.list(session.id)
  return {
    eventTypes: eventStore.list(session.id).map((event) => event.type),
    messageRoles: messages.map((message) => message.role),
    agentStatus: messages.find((message) => message.role === 'agent')?.status,
  }
}

function normalizeEventTypes(types: string[]): string[] {
  return [
    types[0],
    types.includes('thinking.chunk') ? 'thinking.chunk' : 'missing-thinking',
    types.includes('message.chunk') ? 'message.chunk' : 'missing-message',
    types.at(-1),
  ]
}
