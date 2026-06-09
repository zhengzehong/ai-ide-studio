import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore, messageStore } from '../../src/store/sessions.js'
import { timelineConfigStore, timelineStore } from '../../src/store/timeline.js'
import { generateHistoricalTimeline } from '../../src/core/timeline.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-timeline-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('timeline', () => {
  test('generates historical timeline items from stored human messages', async () => {
    const project = projectStore.create({ name: 'Timeline Project', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'codex', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    timelineConfigStore.upsert(project.id, {
      enabled: 1,
      model: 'timeline-model',
      api_key: 'sk-test',
      base_url: 'http://127.0.0.1:1',
      trigger_interval: 999,
    })
    messageStore.append(session.id, { role: 'human', content: '分析打包功能' })
    messageStore.append(session.id, { role: 'agent', content: '已经完成分析' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"items":[{"text":"整理打包功能","turns":"1","time":"12:00"}]}' } }],
      }),
    })) as unknown as typeof fetch)

    await generateHistoricalTimeline(session.id)

    const items = timelineStore.list(session.id)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      session_id: session.id,
      turns: '1',
      status: 'refined',
      model_used: 'timeline-model',
    })
    expect(items[0].summary).toBe('整理打包功能')
  })
})
