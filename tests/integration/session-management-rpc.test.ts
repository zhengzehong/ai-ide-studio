import { describe, test, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { templateStore } from '../../src/store/agent-templates.js'
import { handleWsConnection } from '../../src/gateway/ws-handler.js'
import { acpHost } from '../../src/acp/host.js'
import type { WebSocket, WebSocketServer } from 'ws'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-management-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

function createWs() {
  const handlers = new Map<string, (raw?: unknown) => unknown>()
  const sent: string[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    send(payload: string) { sent.push(payload) },
    on(event: string, handler: (raw?: unknown) => unknown) { handlers.set(event, handler) },
  } as unknown as WebSocket
  handleWsConnection(ws, {} as never, {} as WebSocketServer)
  const onMessage = handlers.get('message')!
  return {
    sent,
    send: async (msg: unknown) => Promise.resolve(onMessage(Buffer.from(JSON.stringify(msg)))),
    last: () => JSON.parse(sent.at(-1) || '{}') as { type: string; requestId?: string; data?: unknown; message?: string },
  }
}

describe('Session management RPC', () => {
  test('sessions.create returns full persisted row with project metadata', async () => {
    const project = projectStore.create({ name: '项目 A', workDir: resolve(tmp, 'project-a') })
    const agent = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock', projectId: project.id })
    const originalIsRunning = acpHost.isRunning
    const originalStartAgent = acpHost.startAgent
    const originalNewSession = acpHost.newSession
    acpHost.isRunning = (() => true) as typeof acpHost.isRunning
    acpHost.startAgent = (async () => undefined) as typeof acpHost.startAgent
    acpHost.newSession = (async (_agentId, ourSessionId) => `acp-${ourSessionId}`) as typeof acpHost.newSession

    try {
      const ws = createWs()
      await ws.send({ type: 'sessions.create', requestId: 'req-create', agentId: agent.id, projectId: project.id })
      const response = ws.last()
      expect(response.type).toBe('result')
      const data = response.data as Record<string, unknown>
      expect(data.id).toMatch(/^sess-/)
      expect(data.agent_id).toBe(agent.id)
      expect(data.project_id).toBe(project.id)
      expect(data.acp_session_id).toBe(`acp-${data.id}`)
      expect(data.status).toBe('active')
      expect(data.started_at).toBeTruthy()
      expect(data.updated_at).toBeTruthy()
    } finally {
      acpHost.isRunning = originalIsRunning
      acpHost.startAgent = originalStartAgent
      acpHost.newSession = originalNewSession
    }
  })

  test('sessions.list filters by projectId and hides deleted sessions', async () => {
    const projectA = projectStore.create({ name: '项目 A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: '项目 B', workDir: resolve(tmp, 'b') })
    const agentA = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ type: 'dev', name: 'Agent B', runtime: 'mock', projectId: projectB.id })
    const keep = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    const deleted = sessionStore.create({ agentId: agentA.id, projectId: projectA.id })
    const other = sessionStore.create({ agentId: agentB.id, projectId: projectB.id })
    sessionStore.delete(deleted.id)

    const ws = createWs()
    await ws.send({ type: 'sessions.list', requestId: 'req-list', projectId: projectA.id })
    const response = ws.last()
    const ids = (response.data as Array<{ id: string }>).map(s => s.id)
    expect(ids).toEqual([keep.id])
    expect(ids).not.toContain(deleted.id)
    expect(ids).not.toContain(other.id)
  })

  test('sessions.rename updates title and returns updated session', async () => {
    const agent = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const ws = createWs()

    await ws.send({ type: 'sessions.rename', requestId: 'req-rename', sessionId: session.id, title: '新的会话标题' })

    const response = ws.last()
    expect(response.type).toBe('result')
    const data = response.data as Record<string, unknown>
    expect(data.id).toBe(session.id)
    expect(data.title).toBe('新的会话标题')
    expect(sessionStore.get(session.id)?.title).toBe('新的会话标题')
  })

  test('sessions.delete soft deletes session and list no longer returns it', async () => {
    const agent = agentStore.create({ type: 'dev', name: 'Agent A', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id })
    const ws = createWs()

    await ws.send({ type: 'sessions.delete', requestId: 'req-delete', sessionId: session.id })
    expect(ws.last().type).toBe('result')
    expect((ws.last().data as Record<string, unknown>).deleted).toBe(true)
    expect(sessionStore.get(session.id)?.deleted_at).toBeTruthy()

    await ws.send({ type: 'sessions.list', requestId: 'req-list-after-delete' })
    const ids = (ws.last().data as Array<{ id: string }>).map(s => s.id)
    expect(ids).not.toContain(session.id)
  })
})


describe('Project Agent RPC', () => {
  test('agents.deployTemplate creates a project scoped Agent from a global template', async () => {
    const project = projectStore.create({ name: '?? A', workDir: resolve(tmp, 'project-agent-a') })
    const otherProject = projectStore.create({ name: '?? B', workDir: resolve(tmp, 'project-agent-b') })
    const template = templateStore.create({
      name: '?????',
      type: 'dev',
      runtime: 'codex',
      icon: 'code',
      systemPrompt: '???????',
      skills: ['??'],
      isBuiltin: true,
    })
    const ws = createWs()

    await ws.send({ type: 'agents.deployTemplate', requestId: 'req-deploy', projectId: project.id, templateId: template.id })

    const response = ws.last()
    expect(response.type).toBe('result')
    const agent = response.data as Record<string, unknown>
    expect(agent.id).toMatch(/^agent-/)
    expect(agent.project_id).toBe(project.id)
    expect(agent.template_id).toBe(template.id)
    expect(agent.name).toBe('?????')
    expect(agent.type).toBe('dev')
    expect(agent.runtime).toBe('codex')
    expect(agent.icon).toBe('code')
    expect(agent.system_prompt).toBe('???????')
    expect(agentStore.list(project.id).map(a => a.id)).toEqual([agent.id])
    expect(agentStore.list(otherProject.id)).toEqual([])
  })

  test('agents.createCustom requires projectId and creates a project scoped Agent', async () => {
    const project = projectStore.create({ name: '??', workDir: resolve(tmp, 'project-custom-agent') })
    const ws = createWs()

    await ws.send({ type: 'agents.createCustom', requestId: 'req-missing-project', name: '???', agentType: 'dev', runtime: 'mock' })
    expect(ws.last().type).toBe('error')
    expect(ws.last().message).toContain('projectId')

    await ws.send({
      type: 'agents.createCustom',
      requestId: 'req-create-custom',
      projectId: project.id,
      name: '??????',
      agentType: 'dev',
      runtime: 'mock',
      systemPrompt: '?????',
      icon: 'bot',
    })

    const response = ws.last()
    expect(response.type).toBe('result')
    const agent = response.data as Record<string, unknown>
    expect(agent.project_id).toBe(project.id)
    expect(agent.template_id).toBeNull()
    expect(agent.name).toBe('??????')
    expect(agent.runtime).toBe('mock')
    expect(agent.system_prompt).toBe('?????')
    expect(agentStore.list(project.id).map(a => a.id)).toEqual([agent.id])
  })

  test('agents.update changes editable project Agent fields', async () => {
    const project = projectStore.create({ name: '??', workDir: resolve(tmp, 'project-update-agent') })
    const agent = agentStore.create({ name: '???', type: 'dev', runtime: 'mock', projectId: project.id, systemPrompt: '????', icon: 'bot' })
    const ws = createWs()

    await ws.send({
      type: 'agents.update',
      requestId: 'req-update-agent',
      agentId: agent.id,
      name: '???',
      agentType: 'architect',
      runtime: 'claude',
      systemPrompt: '????',
      icon: 'brain',
    })

    const response = ws.last()
    expect(response.type).toBe('result')
    const updated = response.data as Record<string, unknown>
    expect(updated.name).toBe('???')
    expect(updated.type).toBe('architect')
    expect(updated.runtime).toBe('claude')
    expect(updated.system_prompt).toBe('????')
    expect(updated.icon).toBe('brain')
    expect(agentStore.get(agent.id)?.name).toBe('???')
  })

  test('agents.delete removes a project Agent from project listing', async () => {
    const project = projectStore.create({ name: '??', workDir: resolve(tmp, 'project-delete-agent') })
    const agent = agentStore.create({ name: '???', type: 'dev', runtime: 'mock', projectId: project.id })
    const ws = createWs()

    await ws.send({ type: 'agents.delete', requestId: 'req-delete-agent', agentId: agent.id })

    expect(ws.last().type).toBe('result')
    expect((ws.last().data as Record<string, unknown>).deleted).toBe(true)
    expect(agentStore.list(project.id).map(a => a.id)).toEqual([])
    expect(agentStore.get(agent.id)).toBeUndefined()
  })
})
