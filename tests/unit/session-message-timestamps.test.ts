import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'

let tmp: string
let originalEnsureSession: typeof acpHost.ensureSession
let originalPrompt: typeof acpHost.prompt

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-message-timestamps-'))
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

describe('message timestamps', () => {
  test('messageStore.append honors an explicit timestamp', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const row = messageStore.append(session.id, { role: 'human', content: 'hi', timestamp: '2026-09-14T07:00:00.000Z' })
    expect(row.timestamp).toBe('2026-09-14T07:00:00.000Z')
    const fallback = messageStore.append(session.id, { role: 'human', content: 'hi2' })
    expect(fallback.timestamp).not.toBe('2026-09-14T07:00:00.000Z')
  })

  test('human message timestamp shares the turn start with the agent message', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    acpHost.ensureSession = (async () => 'acp-session') as typeof acpHost.ensureSession
    acpHost.prompt = (async () => undefined) as typeof acpHost.prompt

    await sessionManager.sendPrompt(session.id, '帮我检查一下', [], { clientMessageId: 'msg-human-order' })

    const humanMessage = messageStore.get('msg-human-order')
    expect(humanMessage?.role).toBe('human')

    const agentRows = messageStore.list(session.id).filter((row) => row.role === 'agent')
    expect(agentRows.length).toBeGreaterThan(0)
    const agentStartedAt = agentRows[0]?.started_at
    expect(agentStartedAt).toBeTruthy()
    // human 时间戳与回合开始时刻同源:团队视图按 started_at 排序时,用户提问不会落到 AI 回合之后
    expect(humanMessage?.timestamp).toBe(agentStartedAt)
  })
})
