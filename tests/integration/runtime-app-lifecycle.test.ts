import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { startApp, type AppHandle } from '../../src/app.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { eventStore, sessionStore } from '../../src/store/sessions.js'

let app: AppHandle | undefined
let tmp: string | undefined

afterEach(async () => {
  await app?.stop()
  app = undefined
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('application Runtime lifecycle', () => {
  test('starts process Runtime after Realtime and persists a complete mock turn', async () => {
    tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-runtime-app-'))
    app = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'local',
      realtimeMode: 'process',
      realtimePort: 0,
      runtimeMode: 'process',
    })
    const agent = agentStore.create({ name: 'Runtime app agent', type: 'developer', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })

    await sessionManager.sendPrompt(session.id, 'hello process runtime')
    await sessionManager.waitForPersistence(session.id)

    expect(app.runtimeMode).toBe('process')
    const eventTypes = eventStore.list(session.id).map((event) => event.type)
    expect(eventTypes[0]).toBe('message.user')
    expect(eventTypes).toContain('message.chunk')
    expect(eventTypes.at(-1)).toBe('message.done')
  }, 15_000)
})
