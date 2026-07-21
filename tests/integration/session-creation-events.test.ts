import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCustomProjectAgent } from '../../src/core/agents.js'
import { events, type AppEvents } from '../../src/core/events.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-created-event-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Session creation events', () => {
  it('publishes the complete primary Session when an Agent is created', () => {
    const project = projectStore.create({ name: '项目 A', workDir: tmp })
    const changed: AppEvents['session:changed'][] = []
    const onChanged = (event: AppEvents['session:changed']): void => { changed.push(event) }
    events.on('session:changed', onChanged)

    try {
      const agent = createCustomProjectAgent({
        projectId: project.id,
        name: 'Agent A',
        type: 'dev',
        runtime: 'mock',
      })

      expect(changed).toHaveLength(1)
      expect(changed[0]).toMatchObject({
        sessionId: expect.stringMatching(/^sess-/),
        data: {
          agent_id: agent.id,
          project_id: project.id,
          is_primary: 1,
          title: '主会话',
        },
      })
    } finally {
      events.off('session:changed', onChanged)
    }
  })

  it('publishes a complete record for an explicitly created Session', async () => {
    const project = projectStore.create({ name: '项目 A', workDir: tmp })
    const agent = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: project.id })
    const changed: AppEvents['session:changed'][] = []
    const onChanged = (event: AppEvents['session:changed']): void => { changed.push(event) }
    events.on('session:changed', onChanged)

    try {
      const session = await sessionManager.createSession(agent.id, undefined, project.id)

      expect(changed).toEqual([{ sessionId: session.id, data: { ...session } }])
    } finally {
      events.off('session:changed', onChanged)
    }
  })
})
