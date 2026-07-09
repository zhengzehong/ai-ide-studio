import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, messageStore } from '../../src/store/sessions.js'
import { globalAssistantStore } from '../../src/store/global-assistant.js'
import { sessionManager } from '../../src/core/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { AGENT_SESSION_BUILTIN_TOOLS } from '../../src/tools/agent-session-seed.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-session-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent session MCP tools', () => {
  test('agent.message.send sends a queued message from current session context', async () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, targetSession, sourceSession, project } = createTwoAgentProject()

    const result = await executeJson(
      'agent.message.send',
      { targetSessionId: targetSession.id, content: 'hello', needReply: true },
      { projectId: project.id, agentId: source.id, sessionId: sourceSession.id },
    )

    expect(asRecord(result.message)).toMatchObject({
      source_session_id: sourceSession.id,
      target_session_id: targetSession.id,
      prompt_status: 'queued',
    })
    expect(asRecord(result.targetSession).id).toBe(targetSession.id)
  })

  test('agent.message.send descriptions tell agents the send call is async and should not wait', () => {
    const seeded = AGENT_SESSION_BUILTIN_TOOLS.find((tool) => tool.name === 'agent.message.send')
    const handler = getHandler('agent.message.send')

    expect(seeded?.description).toContain('异步投递')
    expect(seeded?.description).toContain('立即返回')
    expect(seeded?.description).toContain('不要等待')
    expect(seeded?.description).toContain('自动唤醒来源会话')
    expect(handler?.description).toContain('异步投递')
    expect(handler?.description).toContain('立即返回')
    expect(handler?.description).toContain('不要等待')
    expect(handler?.description).toContain('自动唤醒来源会话')
  })

  test('agent session list and messages enforce current project scope', async () => {
    const { source, sourceSession, project } = createTwoAgentProject()
    messageStore.append(sourceSession.id, { role: 'human', content: 'first' })

    const sessions = await executeJson(
      'agent.session.list',
      { agentId: source.id },
      { projectId: project.id, agentId: source.id, sessionId: sourceSession.id },
    )
    expect(asRecords(sessions.sessions).map((row) => row.id)).toContain(sourceSession.id)

    const messages = await executeJson(
      'agent.session.messages',
      { sessionId: sourceSession.id, limit: 5 },
      { projectId: project.id, agentId: source.id, sessionId: sourceSession.id },
    )
    expect(asRecords(messages.messages).map((row) => row.content)).toEqual(['first'])
  })

  test('agent.session.watch creates one-shot watch from current session context', async () => {
    const { source, targetSession, sourceSession, project } = createTwoAgentProject()

    const created = await executeJson(
      'agent.session.watch',
      { sessionId: targetSession.id },
      { projectId: project.id, agentId: source.id, sessionId: sourceSession.id },
    )
    const watchId = created.watchId as string
    expect(watchId).toBeTruthy()

    const watch = getDb()
      .prepare<[string], { watcher_session_id: string; watched_session_id: string; status: string; once: number; watch_kind: string }>(
        'SELECT watcher_session_id, watched_session_id, status, once, watch_kind FROM agent_session_watches WHERE id = ?',
      )
      .get(watchId)
    expect(watch).toMatchObject({
      watcher_session_id: sourceSession.id,
      watched_session_id: targetSession.id,
      status: 'active',
      once: 1,
      watch_kind: 'session',
    })
  })

  test('agent.session.watch accepts global assistant session with explicit project context', async () => {
    const { targetSession, project } = createTwoAgentProject()
    const globalAgent = agentStore.create({ name: 'Global Assistant', type: 'pm', runtime: 'mock' })
    const globalSession = sessionStore.create({ agentId: globalAgent.id })
    globalAssistantStore.upsert({ agentId: globalAgent.id, sessionId: globalSession.id })

    const created = await executeJson(
      'agent.session.watch',
      { sessionId: targetSession.id, relatedInfo: { source: 'global-assistant' } },
      { projectId: project.id, agentId: globalAgent.id, sessionId: globalSession.id },
    )
    const watchId = created.watchId as string
    const watch = getDb()
      .prepare<[string], { project_id: string | null; watcher_session_id: string; watched_session_id: string; status: string }>(
        'SELECT project_id, watcher_session_id, watched_session_id, status FROM agent_session_watches WHERE id = ?',
      )
      .get(watchId)
    expect(watch).toMatchObject({
      project_id: project.id,
      watcher_session_id: globalSession.id,
      watched_session_id: targetSession.id,
      status: 'active',
    })
  })

  test('agent.task.watch creates persistent watch and can be cancelled', async () => {
    const { source, sourceSession, project } = createTwoAgentProject()
    const taskId = 'task-test-001'

    const created = await executeJson(
      'agent.task.watch',
      { taskId, relatedInfo: { reason: 'wait-completion' } },
      { projectId: project.id, agentId: source.id, sessionId: sourceSession.id },
    )
    const watchId = created.watchId as string
    expect(watchId).toBeTruthy()

    const watch = getDb()
      .prepare<[string], { watcher_session_id: string; task_id: string; status: string; once: number; watch_kind: string }>(
        'SELECT watcher_session_id, task_id, status, once, watch_kind FROM agent_session_watches WHERE id = ?',
      )
      .get(watchId)
    expect(watch).toMatchObject({
      watcher_session_id: sourceSession.id,
      task_id: taskId,
      status: 'active',
      once: 0,
      watch_kind: 'task',
    })

    const cancelled = await executeJson(
      'agent.task.watch.cancel',
      { watchId },
      { projectId: project.id, agentId: source.id, sessionId: sourceSession.id },
    )
    expect(cancelled.ok).toBe(true)
    expect(cancelled.cancelled).toBe(watchId)
  })

  test('seed registers agent communication tools globally', () => {
    seedBuiltinTools()

    const names = getDb()
      .prepare<[], { name: string }>(`
        SELECT tools.name FROM tools
        JOIN tool_bindings ON tool_bindings.tool_id = tools.id
        WHERE tool_bindings.scope = 'global' AND tool_bindings.enabled = 1
          AND tools.name LIKE 'agent.%'
        ORDER BY tools.name
      `)
      .all()
      .map((row) => row.name)

    expect(names).toEqual([
      'agent.message.send',
      'agent.session.list',
      'agent.session.messages',
      'agent.session.watch',
      'agent.task.watch',
      'agent.task.watch.cancel',
      'agent.template.create',
      'agent.template.delete',
      'agent.template.get',
      'agent.template.list',
      'agent.template.update',
      'agent.wake_me',
    ])
  })
})

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function createTwoAgentProject() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const source = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: project.id })
  const target = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: project.id })
  const sourceSession = sessionStore.create({ agentId: source.id, projectId: project.id })
  const targetSession = sessionStore.create({ agentId: target.id, projectId: project.id })
  return { project, source, target, sourceSession, targetSession }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}
