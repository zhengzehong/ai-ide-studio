import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { globalAssistantStore } from '../../src/store/global-assistant.js'
import { sessionManager } from '../../src/core/sessions.js'
import { events } from '../../src/core/events.js'
import { agentSessionCommunicationService } from '../../src/core/agent-session-communication.js'
import { agentSessionMessageStore, agentSessionWatchStore } from '../../src/store/agent-session-communication.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-session-service-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent session communication service', () => {
  test('sendMessage persists message and enqueues target prompt without waiting for target turn', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(() => new Promise(() => undefined))
    const { source, target, sourceSession, targetSession, project } = createTwoAgentProject()

    const result = await agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetSessionId: targetSession.id,
      content: '请帮我检查 ISSUE-1',
      relatedInfo: { issue_id: 'ISSUE-1' },
      needReply: true,
    })

    expect(result.message).toMatchObject({
      source_agent_id: source.id,
      source_session_id: sourceSession.id,
      target_agent_id: target.id,
      target_session_id: targetSession.id,
      need_reply: 1,
      prompt_status: 'queued',
    })
    expect(result.targetSession.id).toBe(targetSession.id)
    expect(enqueuePrompt).toHaveBeenCalledWith(
      targetSession.id,
      expect.stringContaining(`targetSessionId 必须使用 "${sourceSession.id}"`),
      undefined,
      { contextProjectId: project.id },
    )
    expect(enqueuePrompt).toHaveBeenCalledWith(
      targetSession.id,
      expect.stringContaining('调用 agent.message.send 后即可结束当前轮，不要等待来源 Agent；系统会自动唤醒来源会话。'),
      undefined,
      { contextProjectId: project.id },
    )
  })

  test('sendMessage creates a new target session when only targetAgentId is provided', async () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, target, sourceSession, project } = createTwoAgentProject()

    const result = await agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetAgentId: target.id,
      content: '新会话处理一下',
    })

    expect(result.targetSession.agent_id).toBe(target.id)
    expect(result.targetSession.project_id).toBe(project.id)
    expect(result.message.target_session_id).toBe(result.targetSession.id)
  })

  test('project agent can send a project-scoped reply to the configured global assistant session', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, sourceSession, project } = createTwoAgentProject()
    const globalAgent = agentStore.create({ name: 'Global Assistant', type: 'pm', runtime: 'mock' })
    const globalSession = sessionStore.create({ agentId: globalAgent.id })
    globalAssistantStore.upsert({ agentId: globalAgent.id, sessionId: globalSession.id })
    const originalMessage = agentSessionMessageStore.create({
      projectId: project.id,
      sourceAgentId: globalAgent.id,
      sourceSessionId: globalSession.id,
      targetAgentId: source.id,
      targetSessionId: sourceSession.id,
      content: '请处理项目任务',
      needReply: true,
    })

    const result = await agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetSessionId: globalSession.id,
      content: '处理完成，结果已同步',
    })

    expect(result.targetSession.id).toBe(globalSession.id)
    expect(result.message).toMatchObject({
      project_id: project.id,
      source_agent_id: source.id,
      source_session_id: sourceSession.id,
      target_agent_id: globalAgent.id,
      target_session_id: globalSession.id,
    })
    expect(enqueuePrompt).toHaveBeenCalledWith(
      globalSession.id,
      expect.stringContaining('处理完成，结果已同步'),
      undefined,
      { contextProjectId: project.id },
    )
    expect(agentSessionMessageStore.get(originalMessage.id)?.reply_satisfied_at).toBeTruthy()
  })

  test('project agent can send to the configured global assistant by targetAgentId without creating a project session', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, sourceSession, project } = createTwoAgentProject()
    const globalAgent = agentStore.create({ name: 'Global Assistant', type: 'pm', runtime: 'mock' })
    const globalSession = sessionStore.create({ agentId: globalAgent.id })
    globalAssistantStore.upsert({ agentId: globalAgent.id, sessionId: globalSession.id })

    const result = await agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetAgentId: globalAgent.id,
      content: '请全局助理继续汇总',
    })

    expect(result.targetSession.id).toBe(globalSession.id)
    expect(result.targetSession.project_id).toBeNull()
    expect(sessionStore.list(globalAgent.id, project.id)).toHaveLength(0)
    expect(enqueuePrompt).toHaveBeenCalledWith(
      globalSession.id,
      expect.stringContaining('请全局助理继续汇总'),
      undefined,
      { contextProjectId: project.id },
    )
  })

  test('project agent cannot send to a closed global assistant session by targetAgentId', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, sourceSession, project } = createTwoAgentProject()
    const globalAgent = agentStore.create({ name: 'Global Assistant', type: 'pm', runtime: 'mock' })
    const globalSession = sessionStore.create({ agentId: globalAgent.id })
    globalAssistantStore.upsert({ agentId: globalAgent.id, sessionId: globalSession.id })
    sessionStore.updateStatus(globalSession.id, 'closed')

    await expect(agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetAgentId: globalAgent.id,
      content: '不应该投递到关闭会话',
    })).rejects.toThrow('目标会话已关闭')
    expect(enqueuePrompt).not.toHaveBeenCalled()
  })

  test('project agent cannot send to an arbitrary projectless session', async () => {
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, sourceSession, project } = createTwoAgentProject()
    const externalAgent = agentStore.create({ name: 'External', type: 'pm', runtime: 'mock' })
    const externalSession = sessionStore.create({ agentId: externalAgent.id })

    await expect(agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetSessionId: externalSession.id,
      content: '不应该允许',
    })).rejects.toThrow('会话不属于当前项目')
  })

  test('sendMessage rejects blank content before creating a target session', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, target, sourceSession, project } = createTwoAgentProject()
    const beforeCount = sessionStore.list(target.id, project.id).length

    await expect(agentSessionCommunicationService.sendMessage({
      context: { agentId: source.id, sessionId: sourceSession.id, projectId: project.id },
      targetAgentId: target.id,
      content: '   ',
    })).rejects.toThrow('content 不能为空')

    expect(sessionStore.list(target.id, project.id)).toHaveLength(beforeCount)
    expect(enqueuePrompt).not.toHaveBeenCalled()
  })

  test('session done sends one reminder for unresolved needReply messages', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, target, sourceSession, targetSession, project } = createTwoAgentProject()
    const message = agentSessionMessageStore.create({
      projectId: project.id,
      sourceAgentId: source.id,
      sourceSessionId: sourceSession.id,
      targetAgentId: target.id,
      targetSessionId: targetSession.id,
      content: '需要回复',
      relatedInfo: { issue_id: 'ISSUE-1' },
      needReply: true,
    })

    events.emit('session:done', { sessionId: targetSession.id, agentId: target.id, messageId: 'done-1' })
    await Promise.resolve()

    expect(agentSessionMessageStore.get(message.id)?.reply_reminder_count).toBe(1)
    expect(enqueuePrompt).toHaveBeenCalledWith(
      targetSession.id,
      expect.stringContaining('系统还没有检测到你调用 agent.message.send 回传结果'),
      undefined,
      { contextProjectId: project.id },
    )
    expect(enqueuePrompt).toHaveBeenCalledWith(
      targetSession.id,
      expect.stringContaining('发送回复后即可结束当前轮，不要等待来源 Agent；系统会自动唤醒来源会话。'),
      undefined,
      { contextProjectId: project.id },
    )

    events.emit('session:done', { sessionId: targetSession.id, agentId: target.id, messageId: 'done-2' })
    await Promise.resolve()

    expect(enqueuePrompt).toHaveBeenCalledTimes(1)
  })

  test('session done triggers once watch and suppresses it when a response message already exists', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { source, target, sourceSession, targetSession, project } = createTwoAgentProject()
    const watch = agentSessionWatchStore.create({
      projectId: project.id,
      watcherAgentId: source.id,
      watcherSessionId: sourceSession.id,
      watchedAgentId: target.id,
      watchedSessionId: targetSession.id,
      relatedInfo: { event_id: 'evt-1' },
      once: true,
    })

    events.emit('session:done', { sessionId: targetSession.id, agentId: target.id, messageId: 'done-watch', turnId: 'turn-watch' })
    await Promise.resolve()

    expect(agentSessionWatchStore.get(watch.id)?.status).toBe('triggered')
    expect(enqueuePrompt).toHaveBeenCalledWith(
      sourceSession.id,
      expect.stringContaining(`Watch ID：${watch.id}`),
      undefined,
      { contextProjectId: project.id },
    )

    const secondWatch = agentSessionWatchStore.create({
      projectId: project.id,
      watcherAgentId: source.id,
      watcherSessionId: sourceSession.id,
      watchedAgentId: target.id,
      watchedSessionId: targetSession.id,
      once: true,
    })
    agentSessionMessageStore.create({
      projectId: project.id,
      sourceAgentId: target.id,
      sourceSessionId: targetSession.id,
      targetAgentId: source.id,
      targetSessionId: sourceSession.id,
      content: '已经回复',
    })

    events.emit('session:done', { sessionId: targetSession.id, agentId: target.id, messageId: 'done-suppressed' })
    await Promise.resolve()

    expect(agentSessionWatchStore.get(secondWatch.id)?.status).toBe('triggered')
    expect(enqueuePrompt).toHaveBeenCalledTimes(1)
  })

  test('global assistant can create a project-scoped watch from explicit project context', () => {
    const { target, targetSession, project } = createTwoAgentProject()
    const globalAgent = agentStore.create({ name: 'Global Assistant', type: 'pm', runtime: 'mock' })
    const globalSession = sessionStore.create({ agentId: globalAgent.id })
    globalAssistantStore.upsert({ agentId: globalAgent.id, sessionId: globalSession.id })

    const watch = agentSessionCommunicationService.createWatch({
      context: { agentId: globalAgent.id, sessionId: globalSession.id, projectId: project.id },
      sessionId: targetSession.id,
      relatedInfo: { source: 'global-assistant' },
    })

    expect(watch).toMatchObject({
      project_id: project.id,
      watcher_agent_id: globalAgent.id,
      watcher_session_id: globalSession.id,
      watched_agent_id: target.id,
      watched_session_id: targetSession.id,
      status: 'active',
    })
  })

  test('watch trigger preserves project context when waking global assistant', async () => {
    const enqueuePrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    const { target, targetSession, project } = createTwoAgentProject()
    const globalAgent = agentStore.create({ name: 'Global Assistant', type: 'pm', runtime: 'mock' })
    const globalSession = sessionStore.create({ agentId: globalAgent.id })
    globalAssistantStore.upsert({ agentId: globalAgent.id, sessionId: globalSession.id })
    agentSessionWatchStore.create({
      projectId: project.id,
      watcherAgentId: globalAgent.id,
      watcherSessionId: globalSession.id,
      watchedAgentId: target.id,
      watchedSessionId: targetSession.id,
      once: true,
    })

    events.emit('session:done', { sessionId: targetSession.id, agentId: target.id, messageId: 'done-global-watch' })
    await Promise.resolve()

    expect(enqueuePrompt).toHaveBeenCalledWith(
      globalSession.id,
      expect.stringContaining('done-global-watch'),
      undefined,
      { contextProjectId: project.id },
    )
  })
})

function createTwoAgentProject() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const source = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: project.id })
  const target = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: project.id })
  const sourceSession = sessionStore.create({ agentId: source.id, projectId: project.id })
  const targetSession = sessionStore.create({ agentId: target.id, projectId: project.id })
  return { project, source, target, sourceSession, targetSession }
}
