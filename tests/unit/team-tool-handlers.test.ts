import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { templateStore } from '../../src/store/agent-templates.js'
import { taskStore } from '../../src/store/tasks.js'
import { teamMailboxStore } from '../../src/store/teams.js'
import { sessionManager } from '../../src/core/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandler, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team MCP tool handlers', () => {
  test('team.create 创建 Team、初始 member 和团队会话', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })

    const created = await executeJson('team.create', { name: 'Alpha', description: '协作组' }, {
      projectId: project.id,
      agentId: agent.id,
    })

    expect(asRecord(created.team)).toMatchObject({ name: 'Alpha', project_id: project.id })
    expect(asRecord(created.member)).toMatchObject({ agent_id: agent.id, role: 'leader' })
    expect(asRecord(created.session)).toMatchObject({ agent_id: agent.id, project_id: project.id })
  })

  test('team.member.spawn 从模板创建成员 Agent 和 Session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const template = templateStore.create({ name: '测试工程师', type: 'tester', runtime: 'mock', systemPrompt: '补测试' })

    const spawned = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, templateId: template.id })

    expect(asRecord(spawned.agent)).toMatchObject({ name: '测试工程师', template_id: template.id, project_id: project.id })
    expect(asRecord(spawned.member)).toMatchObject({ team_id: asRecord(team.team).id, role: 'member' })
    expect(asRecord(spawned.session)).toMatchObject({ agent_id: asRecord(spawned.agent).id, project_id: project.id })
  })

  test('team.mailbox.send 只记录消息，不触发成员 prompt', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const memberId = asRecord(team.member).id as string
    const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt')

    const sent = await executeJson('team.mailbox.send', { type: 'report', content: '已完成' }, {
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      teamMemberId: memberId,
    })

    expect(asRecord(sent.message)).toMatchObject({ from_member_id: memberId, content: '已完成' })
    expect(teamMailboxStore.list(asRecord(team.team).id as string)).toHaveLength(1)
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  test('team.member.message 异步派活并立即返回 accepted', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt').mockResolvedValue(undefined)

    const result = await executeJson('team.member.message', {
      teamId: asRecord(team.team).id,
      memberId: asRecord(team.member).id,
      content: '开始执行',
    })

    expect(result.status).toBe('accepted')
    expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('开始执行'))
  })

  test('team.task.update 可以把团队任务更新为 completed', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: '实现测试',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(team.member).id as string,
    })

    const updated = await executeJson('team.task.update', {
      teamId: asRecord(team.team).id,
      taskId: task.id,
      status: 'completed',
      stage: '已完成',
    })

    expect(asRecord(updated.task)).toMatchObject({ id: task.id, status: 'completed', stage: '已完成' })
    expect(taskStore.get(task.id)?.completed_at).toBeTruthy()
  })

  test('team.task.update 取消指派时同步清空 Agent 指派', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: '取消指派',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(team.member).id as string,
      assignAgentId: agent.id,
    })

    const updated = await executeJson('team.task.update', {
      teamId: asRecord(team.team).id,
      taskId: task.id,
      assigneeMemberId: null,
    })

    expect(asRecord(updated.task)).toMatchObject({
      id: task.id,
      assignee_member_id: null,
      assigned_agent_id: null,
    })
  })

  test('Team 工具拒绝访问当前项目外的 Team', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: tmp })
    const projectB = projectStore.create({ name: 'B', workDir: tmp })
    const agentA = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const teamB = await executeJson('team.create', { name: 'Beta' }, { projectId: projectB.id, agentId: agentB.id })
    const handler = getRequiredHandler('team.get')

    await expect(handler.execute({ teamId: asRecord(teamB.team).id }, { projectId: projectA.id, agentId: agentA.id }))
      .rejects.toThrow('Team 不属于当前项目')
  })

  test('Team mailbox 不允许伪造当前成员身份', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const other = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const member = await executeJson('team.member.spawn', {
      teamId: asRecord(team.team).id,
      agentId: other.id,
      name: 'Other',
    })
    const handler = getRequiredHandler('team.mailbox.send')

    await expect(handler.execute({
      teamId: asRecord(team.team).id,
      fromMemberId: asRecord(member.member).id,
      content: '伪造发送者',
    }, {
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      teamMemberId: asRecord(team.member).id as string,
    })).rejects.toThrow('fromMemberId 不匹配当前成员上下文')
  })
})

async function executeJson(handlerName: string, input: Record<string, unknown>, context: ToolContext = {}): Promise<Record<string, unknown>> {
  const handler = getRequiredHandler(handlerName)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function getRequiredHandler(handlerName: string): ToolHandler {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  return handler
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}
