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

  test('sends full user text and outcome-focused agent output to timeline model', async () => {
    const project = projectStore.create({ name: 'Prompt Project', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'codex', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    timelineConfigStore.upsert(project.id, {
      enabled: 1,
      model: 'timeline-model',
      api_key: 'sk-test',
      base_url: 'http://127.0.0.1:1',
      trigger_interval: 999,
    })

    const fullUserInput = [
      'Please review the workspace timeline regenerate flow.',
      'The summary must mention the concrete module, action, verification, commit, and prd sync result.',
      'USER_TAIL_MARKER_KEEP_THIS_TEXT',
    ].join(' ')
    const agentOutput = [
      'Initial analysis '.repeat(40),
      'Reviewed src/core/timeline.ts and tests/unit/timeline.test.ts.',
      'Changed prompt payload handling and added regression coverage.',
      'AGENT_FINAL_OUTCOME_MARKER npm test, build, and lint passed; committed abc123 and synced prd def456.',
    ].join(' ')

    messageStore.append(session.id, { role: 'human', content: fullUserInput })
    messageStore.append(session.id, { role: 'agent', content: agentOutput })

    let capturedPrompt = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] }
      capturedPrompt = body.messages[0]?.content ?? ''
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"items":[{"text":"Reviewed timeline prompt payload and synced prd","turns":"1","time":"12:00"}]}',
              },
            },
          ],
        }),
      }
    }) as unknown as typeof fetch)

    await generateHistoricalTimeline(session.id)

    expect(capturedPrompt).toContain('USER_TAIL_MARKER_KEEP_THIS_TEXT')
    expect(capturedPrompt).toContain('AGENT_FINAL_OUTCOME_MARKER')
    expect(capturedPrompt).toContain('处理对象')
    expect(capturedPrompt).toContain('实际动作')
    expect(capturedPrompt).toContain('最终结果')
    expect(capturedPrompt).toContain('Good example')
    expect(capturedPrompt).toContain('Bad example')
    expect(capturedPrompt).toContain('不要输出泛泛摘要')
  })

  test('splits very long agent output into beginning middle and ending excerpts', async () => {
    const project = projectStore.create({ name: 'Long Output Project', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'codex', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    timelineConfigStore.upsert(project.id, {
      enabled: 1,
      model: 'timeline-model',
      api_key: 'sk-test',
      base_url: 'http://127.0.0.1:1',
      trigger_interval: 999,
    })

    const longAgentOutput = [
      'BEGINNING_MARKER reviewed timeline context. ',
      Array.from({ length: 1800 }, (_, index) => `left${String(index).padStart(4, '0')}`).join(' '),
      'MIDDLE_MARKER verified payload splitting. ',
      Array.from({ length: 1800 }, (_, index) => `rght${String(index).padStart(4, '0')}`).join(' '),
      'ENDING_MARKER final result passed tests and synced prd.',
    ].join('')

    messageStore.append(session.id, { role: 'human', content: 'Summarize long timeline work output.' })
    messageStore.append(session.id, { role: 'agent', content: longAgentOutput })

    let capturedPrompt = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] }
      capturedPrompt = body.messages[0]?.content ?? ''
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"items":[{"text":"Split long timeline output and kept final result","turns":"1","time":"12:00"}]}',
              },
            },
          ],
        }),
      }
    }) as unknown as typeof fetch)

    await generateHistoricalTimeline(session.id)

    expect(capturedPrompt).toContain('"agent_output_parts"')
    expect(capturedPrompt).not.toContain('"agent_output":')
    expect(capturedPrompt).toContain('BEGINNING_MARKER')
    expect(capturedPrompt).toContain('MIDDLE_MARKER')
    expect(capturedPrompt).toContain('ENDING_MARKER')
  })

  test('keeps verbose english output under word limit as full agent output', async () => {
    const project = projectStore.create({ name: 'Word Limit Project', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'codex', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    timelineConfigStore.upsert(project.id, {
      enabled: 1,
      model: 'timeline-model',
      api_key: 'sk-test',
      base_url: 'http://127.0.0.1:1',
      trigger_interval: 999,
    })

    const verboseAgentOutput = [
      'WORD_LIMIT_MARKER_START',
      Array.from({ length: 1200 }, (_, index) => `word${index}`).join(' '),
      'WORD_LIMIT_MARKER_END',
    ].join(' ')

    messageStore.append(session.id, { role: 'human', content: 'Summarize verbose but acceptable output.' })
    messageStore.append(session.id, { role: 'agent', content: verboseAgentOutput })

    let capturedPrompt = ''
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] }
      capturedPrompt = body.messages[0]?.content ?? ''
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"items":[{"text":"Kept verbose output and extracted final result","turns":"1","time":"12:00"}]}',
              },
            },
          ],
        }),
      }
    }) as unknown as typeof fetch)

    await generateHistoricalTimeline(session.id)

    expect(capturedPrompt).toContain('"agent_output"')
    expect(capturedPrompt).not.toContain('"agent_output_parts"')
    expect(capturedPrompt).toContain('WORD_LIMIT_MARKER_START')
    expect(capturedPrompt).toContain('WORD_LIMIT_MARKER_END')
  })
})
