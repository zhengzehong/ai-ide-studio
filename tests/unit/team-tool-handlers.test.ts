import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { seedBuiltinTemplates, templateStore } from '../../src/store/agent-templates.js'
import { taskStore } from '../../src/store/tasks.js'
import { teamMailboxStore } from '../../src/store/teams.js'
import { sessionManager } from '../../src/core/sessions.js'
import { events } from '../../src/core/events.js'
import { teamService } from '../../src/core/teams.js'
import { acpHost } from '../../src/acp/host.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { applyToolProfileToAgent } from '../../src/tools/team-profiles.js'
import { resolveVisiblePlatformTools } from '../../src/tools/registry/visibility-resolver.js'
import { resolveToolsForSession } from '../../src/tools/resolver.js'
import { listRuntimeTools } from '../../src/tools/runtime/tool-runtime.js'
import { teamMemberStore } from '../../src/store/teams.js'
import { listWidgetSessionProjectionRows } from '../../src/store/widget-session-list.js'
import { eventCenterService } from '../../src/core/event-center.js'
import type { ToolContext, ToolHandler, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  seedBuiltinTemplates()
  seedBuiltinTools()
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team MCP tool handlers', () => {
  test('team task creation emits global task update for task boards', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const created = teamService.create({ projectId: project.id, leaderAgentId: leader.id, name: 'Alpha' })
    const updates: Array<{ taskId: string; data: Record<string, unknown> }> = []
    const handler = (ev: { taskId: string; data: Record<string, unknown> }) => updates.push(ev)
    events.on('task:update', handler)

    try {
      const task = teamService.createTask({ teamId: created.team.id, title: 'Build UI' })

      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({
        taskId: task.id,
        data: { id: task.id, team_id: created.team.id, event: 'created' },
      })
      const taskEvents = eventCenterService.listEvents({ projectId: project.id, categoryId: 'task.lifecycle' })
      expect(taskEvents).toHaveLength(1)
      expect(JSON.parse(taskEvents[0].payload_json)).toMatchObject({
        taskId: task.id,
        taskStatus: 'draft',
        changeType: 'created',
      })
    } finally {
      events.off('task:update', handler)
    }
  })

  test('team task updates emit global task update for task boards', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const created = teamService.create({ projectId: project.id, leaderAgentId: leader.id, name: 'Alpha' })
    const task = teamService.createTask({ teamId: created.team.id, title: 'Build API' })
    const updates: Array<{ taskId: string; data: Record<string, unknown> }> = []
    const handler = (ev: { taskId: string; data: Record<string, unknown> }) => updates.push(ev)
    events.on('task:update', handler)

    try {
      teamService.updateTask({ teamId: created.team.id, taskId: task.id, status: 'completed', stage: 'Done' })

      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({
        taskId: task.id,
        data: { id: task.id, status: 'completed', stage: 'Done', event: 'updated' },
      })
      const taskEvents = eventCenterService.listEvents({ projectId: project.id, categoryId: 'task.lifecycle' })
      expect(taskEvents.map((event) => JSON.parse(event.payload_json).changeType)).toEqual(['status_changed', 'created'])
      expect(JSON.parse(taskEvents[0].payload_json)).toMatchObject({
        taskId: task.id,
        taskStatus: 'completed',
        previousStatus: 'draft',
      })
    } finally {
      events.off('task:update', handler)
    }
  })

  test('team.create ignores model-provided projectId when session context already has a project', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })

    const created = await executeJson(
      'team.create',
      { projectId: 'ai-ide-studio', name: 'Alpha' },
      {
        projectId: project.id,
        agentId: agent.id,
      },
    )

    expect(asRecord(created.team)).toMatchObject({ name: 'Alpha', project_id: project.id })
  })

  test('team.create ignores caller and model leader IDs and creates a fixed Master', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const other = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: project.id })

    const created = await executeJson(
      'team.create',
      { name: 'Alpha', leaderAgentId: other.id },
      {
        projectId: project.id,
        agentId: leader.id,
      },
    )

    const member = asRecord(created.member)
    expect(member).toMatchObject({ role: 'leader' })
    expect(member.agent_id).not.toBe(leader.id)
    expect(member.agent_id).not.toBe(other.id)
    expect(agentStore.get(member.agent_id as string)).toMatchObject({ template_id: 'tpl-team-leader' })
    expect(agentStore.get(member.agent_id as string)?.hidden_at).toBeTruthy()
    expect(asRecord(created.session)).toMatchObject({ agent_id: member.agent_id, project_id: project.id })
  })

  test('team.create creates Team, initial member, and team session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })

    const created = await executeJson(
      'team.create',
      { name: 'Alpha', description: 'Team collaboration', masterPrompt: '你是自定义 Master' },
      {
        projectId: project.id,
        agentId: agent.id,
      },
    )

    const member = asRecord(created.member)
    expect(asRecord(created.team)).toMatchObject({ name: 'Alpha', project_id: project.id, master_prompt: '你是自定义 Master' })
    expect(member).toMatchObject({ role: 'leader' })
    expect(member.agent_id).not.toBe(agent.id)
    expect(agentStore.get(member.agent_id as string)).toMatchObject({ system_prompt: '你是自定义 Master', hidden_at: expect.any(String) })
    expect(asRecord(created.session)).toMatchObject({ agent_id: member.agent_id, project_id: project.id })
  })

  test('team.create uses the builtin Master prompt and exposes the leader profile by default', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const caller = agentStore.create({ name: 'Caller', type: 'dev', runtime: 'mock', projectId: project.id })
    const created = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: caller.id })
    const member = asRecord(created.member)
    const master = agentStore.get(member.agent_id as string)
    const template = templateStore.get('tpl-team-leader')
    expect(master).toMatchObject({ template_id: 'tpl-team-leader', system_prompt: template?.system_prompt })
    expect(JSON.parse(master?.config_json ?? '{}')).toMatchObject({ teamInternal: true })
    expect(master?.hidden_at).toBeTruthy()
    expect(asRecord(created.team).master_prompt).toBe(template?.system_prompt)
    const visible = resolveVisiblePlatformTools({ agentId: master?.id, projectId: project.id, sessionId: member.session_id as string })
      .map((tool) => tool.definition.name)
    expect(visible).toEqual(expect.arrayContaining(['team.member.spawn', 'team.member.message', 'team.task.create']))
  })

  test('team.update keeps the stored and Agent Master prompts in sync', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const created = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id })
    const teamId = asRecord(created.team).id as string
    const masterAgentId = asRecord(created.member).agent_id as string
    const updated = await executeJson('team.update', { teamId, masterPrompt: '新的 Master 规则' }, { projectId: project.id })
    expect(asRecord(updated.team).master_prompt).toBe('新的 Master 规则')
    expect(agentStore.get(masterAgentId)?.system_prompt).toBe('新的 Master 规则')
  })

  test('new Team members are internal while an existing Agent stays visible', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const caller = agentStore.create({ name: 'Caller', type: 'dev', runtime: 'mock', projectId: project.id })
    const created = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: caller.id })
    const template = templateStore.create({ name: 'Tester', type: 'tester', runtime: 'mock' })
    const internal = await executeJson('team.member.spawn', { teamId: asRecord(created.team).id, templateId: template.id })
    const existing = await executeJson('team.member.spawn', { teamId: asRecord(created.team).id, agentId: caller.id })

    expect(JSON.parse(asRecord(internal.agent).config_json as string)).toMatchObject({ teamInternal: true })
    expect(asRecord(internal.agent).hidden_at).toEqual(expect.any(String))
    expect(JSON.parse(asRecord(existing.agent).config_json as string ?? '{}').teamInternal).not.toBe(true)
    expect(asRecord(existing.agent).hidden_at).toBeNull()
    const widgetAgentIds = listWidgetSessionProjectionRows(project.id).map((row) => row.agent_id)
    expect(widgetAgentIds).not.toContain(asRecord(internal.agent).id)
    expect(widgetAgentIds).toContain(caller.id)
  })

  test('team.create keeps the caller session separate from the fixed Master session', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const callerSession = sessionStore.create({ agentId: leader.id, projectId: project.id })

    const created = await executeJson(
      'team.create',
      { name: 'Alpha' },
      {
        projectId: project.id,
        agentId: leader.id,
        sessionId: callerSession.id,
      },
    )

    const member = asRecord(created.member)
    expect(member).toMatchObject({ role: 'leader' })
    expect(member.session_id).not.toBe(callerSession.id)
    expect(member.agent_id).not.toBe(leader.id)
    expect(sessionStore.list(leader.id, project.id).map((session) => session.id)).toEqual([callerSession.id])
  })

  test('Team Leader session prompts include no-wait collaboration contract for ACP', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const leaderSessionId = asRecord(team.member).session_id as string
    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    let sentContent = ''

    acpHost.ensureSession = (async () => `acp-${leaderSessionId}`) as typeof acpHost.ensureSession
    acpHost.prompt = (async (_agentId, _sessionId, content) => {
      sentContent = content
    }) as typeof acpHost.prompt

    try {
      await sessionManager.sendPrompt(leaderSessionId, '请创建团队并派活')
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }

    expect(sentContent).toContain('Team Leader 协作规则')
    expect(sentContent).toContain('team.member.message')
    expect(sentContent).toContain('不要使用 sleep')
    expect(sentContent).toContain('系统会在成员通过 mailbox')
    expect(sentContent).toContain('用户请求：\n请创建团队并派活')
    expect(messageStore.list(leaderSessionId).filter((message) => message.role === 'human').at(-1)?.content).toBe('请创建团队并派活')
  })

  test('Team Leader profile injects the collaboration contract when its tools are visible', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: leader.id })
    const session = await sessionManager.createSession(leader.id, undefined, project.id)
    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    let sentContent = ''

    acpHost.ensureSession = (async () => `acp-${session.id}`) as typeof acpHost.ensureSession
    acpHost.prompt = (async (_agentId, _sessionId, content) => {
      sentContent = content
    }) as typeof acpHost.prompt

    try {
      await sessionManager.sendPrompt(session.id, '创建一个 Team 并派活')
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }

    expect(sentContent).toContain('Team Leader 协作规则')
    expect(sentContent).toContain('用户请求：\n创建一个 Team 并派活')
    expect(messageStore.list(session.id).filter((message) => message.role === 'human').at(-1)?.content).toBe('创建一个 Team 并派活')
  })

  test('normal non-Team sessions are not wrapped with Team Leader contract', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = await sessionManager.createSession(agent.id, undefined, project.id)
    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    let sentContent = ''

    acpHost.ensureSession = (async () => `acp-${session.id}`) as typeof acpHost.ensureSession
    acpHost.prompt = (async (_agentId, _sessionId, content) => {
      sentContent = content
    }) as typeof acpHost.prompt

    try {
      await sessionManager.sendPrompt(session.id, '普通对话')
    } finally {
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }

    expect(sentContent).toBe('普通对话')
  })

  test('fixed Master bindings expose orchestration tools through both MCP gateways', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: leader.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })

    const masterAgentId = asRecord(team.member).agent_id as string
    const sessionId = asRecord(team.member).session_id as string
    const visibleNames = resolveVisiblePlatformTools({ agentId: masterAgentId, projectId: project.id, sessionId }).map(
      (tool) => tool.definition.name,
    )
    const resolvedNames = resolveToolsForSession(masterAgentId, project.id, sessionId).map((tool) => tool.definition.name)
    const runtimeNames = listRuntimeTools({
      sessionId,
      agentId: masterAgentId,
      projectId: project.id,
      visibleTools: visibleNames,
    }).map((tool) => tool.name)

    for (const names of [visibleNames, resolvedNames, runtimeNames]) {
      expect(names).toContain('team.member.spawn')
      expect(names).toContain('team.member.message')
      expect(names).toContain('team.task.create')
      expect(names).not.toContain('team.mailbox.list')
      expect(names).not.toContain('team.task.list')
      expect(names).not.toContain('core.session.get')
    }
  })

  test('Team Master wake runtime exposes orchestration tools', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: leader.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const leaderMember = teamMemberStore.get(asRecord(team.member).id as string)
    if (!leaderMember) throw new Error('leader member missing')
    const visibleNames = resolveVisiblePlatformTools({
      agentId: leaderMember.agent_id,
      projectId: project.id,
      sessionId: leaderMember.session_id,
    }).map((tool) => tool.definition.name)

    expect(visibleNames).toContain('team.member.spawn')
    expect(visibleNames).toContain('team.member.message')
    expect(visibleNames).not.toContain('team.mailbox.list')
    expect(visibleNames).not.toContain('team.task.list')
  })

  test('team.member.spawn exposes only the member collaboration tools', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: leader.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const template = templateStore.create({
      name: 'Tester',
      type: 'tester',
      runtime: 'mock',
      systemPrompt: 'Write tests',
    })

    const spawned = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, templateId: template.id })

    const visibleNames = resolveVisiblePlatformTools({
      agentId: asRecord(spawned.agent).id as string,
      projectId: project.id,
    }).map((tool) => tool.definition.name)
    expect(visibleNames).toContain('team.mailbox.send')
    expect(visibleNames).toContain('team.task.update')
    expect(visibleNames).not.toContain('team.create')
    expect(visibleNames).not.toContain('team.member.spawn')
  })

  test('team.member.spawn creates member Agent and Session from template', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const template = templateStore.create({
      name: 'Tester',
      type: 'tester',
      runtime: 'mock',
      systemPrompt: 'Add tests',
    })

    const spawned = await executeJson('team.member.spawn', { teamId: asRecord(team.team).id, templateId: template.id })

    expect(asRecord(spawned.agent)).toMatchObject({ name: 'Tester', template_id: template.id, project_id: project.id })
    expect(asRecord(spawned.member)).toMatchObject({ team_id: asRecord(team.team).id, role: 'member' })
    expect(asRecord(spawned.session)).toMatchObject({ agent_id: asRecord(spawned.agent).id, project_id: project.id })
  })

  test('team.mailbox.send records mailbox only without member prompt', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const memberId = asRecord(team.member).id as string
    const sendPrompt = vi.spyOn(sessionManager, 'sendPrompt')

    const sent = await executeJson(
      'team.mailbox.send',
      { type: 'report', content: 'done' },
      {
        projectId: project.id,
        teamId: asRecord(team.team).id as string,
        teamMemberId: memberId,
      },
    )

    expect(asRecord(sent.message)).toMatchObject({ from_member_id: memberId, content: 'done' })
    expect(teamMailboxStore.list(asRecord(team.team).id as string)).toHaveLength(1)
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  test('team.member.message dispatches async work and returns accepted immediately', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    const result = await executeJson('team.member.message', {
      teamId: asRecord(team.team).id,
      memberId: asRecord(team.member).id,
      content: 'start work',
    })

    expect(result.status).toBe('accepted')
    expect(sendPrompt).toHaveBeenCalledWith(
      asRecord(team.member).session_id,
      'start work',
      undefined,
      expect.objectContaining({ senderRole: 'team-assignment', senderName: 'Master', modelContent: expect.stringContaining('start work') }),
    )
  })

  test('team.member.message queues dispatch when the member session is already active', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const spawned = await executeJson('team.member.spawn', {
      teamId: asRecord(team.team).id,
      agentId: worker.id,
      name: 'Worker',
    })
    vi.spyOn(sessionManager, 'isPromptActive').mockReturnValueOnce(true).mockReturnValue(false)
    const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    const result = await executeJson(
      'team.member.message',
      {
        teamId: asRecord(team.team).id,
        memberId: asRecord(spawned.member).id,
        content: 'review the plan',
      },
      { projectId: project.id, agentId: leader.id },
    )
    await Promise.resolve()

    events.emit('session:done', {
      sessionId: asRecord(spawned.member).session_id as string,
      agentId: worker.id,
      messageId: 'worker-done',
    })
    await Promise.resolve()

    expect(result.status).toBe('queued')
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(sendPrompt).toHaveBeenLastCalledWith(
      asRecord(spawned.member).session_id,
      'review the plan',
      undefined,
      expect.objectContaining({ senderRole: 'team-assignment', senderName: 'Master', modelContent: expect.stringContaining('review the plan') }),
    )
  })

  test('team.member.message prompt tells members to report and not wait for leader', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: 'Prompt contract',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(team.member).id as string,
    })
    const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    await executeJson('team.member.message', {
      teamId: asRecord(team.team).id,
      memberId: asRecord(team.member).id,
      content: 'start work',
      taskId: task.id,
    })

    expect(sendPrompt).toHaveBeenCalledWith(
      asRecord(team.member).session_id,
      'start work',
      undefined,
      expect.objectContaining({ modelContent: expect.stringContaining('禁止等待 Leader') }),
    )
    expect(sendPrompt).toHaveBeenCalledWith(
      asRecord(team.member).session_id,
      'start work',
      undefined,
      expect.objectContaining({ modelContent: expect.stringContaining('team.mailbox.send') }),
    )
    expect(sendPrompt).toHaveBeenCalledWith(
      asRecord(team.member).session_id,
      'start work',
      undefined,
      expect.objectContaining({ modelContent: expect.stringContaining('team.task.update') }),
    )
  })

  test('team.mailbox.send from member wakes the leader with a system prompt', async () => {
    vi.useFakeTimers()
    try {
      const project = projectStore.create({ name: 'P', workDir: tmp })
      const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
      const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
      const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
      const spawned = await executeJson('team.member.spawn', {
        teamId: asRecord(team.team).id,
        agentId: worker.id,
        name: 'Worker',
      })
      const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

      await executeJson(
        'team.mailbox.send',
        {
          type: 'report',
          content: 'finished the work',
        },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(spawned.member).id as string,
          agentId: worker.id,
        },
      )
      await vi.advanceTimersByTimeAsync(2_100)

      expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('Team'))
      expect(sendPrompt).toHaveBeenCalledWith(
        asRecord(team.member).session_id,
        expect.stringContaining('finished the work'),
      )
      expect(sendPrompt).toHaveBeenCalledWith(
        asRecord(team.member).session_id,
        expect.stringContaining('不要使用 sleep'),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('team.mailbox.send delays task-bound report wake so task completion can coalesce it', async () => {
    vi.useFakeTimers()
    try {
      const project = projectStore.create({ name: 'P', workDir: tmp })
      const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
      const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
      const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
      const spawned = await executeJson('team.member.spawn', {
        teamId: asRecord(team.team).id,
        agentId: worker.id,
        name: 'Worker',
      })
      const task = taskStore.create({
        title: 'Complete me',
        source: 'agent',
        projectId: project.id,
        teamId: asRecord(team.team).id as string,
        assigneeMemberId: asRecord(spawned.member).id as string,
        assignAgentId: worker.id,
      })
      const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

      await executeJson(
        'team.mailbox.send',
        {
          type: 'report',
          content: 'finished the work',
          taskId: task.id,
        },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(spawned.member).id as string,
          agentId: worker.id,
        },
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(sendPrompt).not.toHaveBeenCalled()

      await executeJson(
        'team.task.update',
        {
          taskId: task.id,
          status: 'completed',
        },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(spawned.member).id as string,
          agentId: worker.id,
        },
      )
      await vi.advanceTimersByTimeAsync(2_100)

      expect(sendPrompt).toHaveBeenCalledTimes(1)
      expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('completed'))
    } finally {
      vi.useRealTimers()
    }
  })

  test('team.mailbox.send queues leader wake when leader session is active', async () => {
    vi.useFakeTimers()
    try {
      const project = projectStore.create({ name: 'P', workDir: tmp })
      const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
      const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
      const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
      const spawned = await executeJson('team.member.spawn', {
        teamId: asRecord(team.team).id,
        agentId: worker.id,
        name: 'Worker',
      })
      const sendPrompt = vi
        .spyOn(sessionManager, 'enqueuePrompt')
        .mockRejectedValueOnce(new Error('当前会话正在生成中，请等待本轮完成或先停止生成'))
        .mockResolvedValue(undefined)

      await executeJson(
        'team.mailbox.send',
        {
          type: 'report',
          content: 'queued report',
        },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(spawned.member).id as string,
          agentId: worker.id,
        },
      )
      await vi.advanceTimersByTimeAsync(2_100)

      events.emit('session:done', {
        sessionId: asRecord(team.member).session_id as string,
        agentId: leader.id,
        messageId: 'leader-done',
      })
      await vi.advanceTimersByTimeAsync(2_100)

      expect(sendPrompt).toHaveBeenCalledTimes(2)
      expect(sendPrompt).toHaveBeenLastCalledWith(
        asRecord(team.member).session_id,
        expect.stringContaining('queued report'),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('team.task.update by member wakes the leader when task reaches completed', async () => {
    vi.useFakeTimers()
    try {
      const project = projectStore.create({ name: 'P', workDir: tmp })
      const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
      const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
      const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
      const spawned = await executeJson('team.member.spawn', {
        teamId: asRecord(team.team).id,
        agentId: worker.id,
        name: 'Worker',
      })
      const task = taskStore.create({
        title: 'Complete me',
        source: 'agent',
        projectId: project.id,
        teamId: asRecord(team.team).id as string,
        assigneeMemberId: asRecord(spawned.member).id as string,
        assignAgentId: worker.id,
      })
      const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

      await executeJson(
        'team.task.update',
        {
          taskId: task.id,
          status: 'completed',
          stage: 'done',
        },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(spawned.member).id as string,
          agentId: worker.id,
        },
      )
      await vi.advanceTimersByTimeAsync(2_100)

      expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining(task.id))
      expect(sendPrompt).toHaveBeenCalledWith(asRecord(team.member).session_id, expect.stringContaining('completed'))
    } finally {
      vi.useRealTimers()
    }
  })

  test('team.task.update rejects member updating another member task', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const workerA = agentStore.create({ name: 'Worker A', type: 'dev', runtime: 'mock', projectId: project.id })
    const workerB = agentStore.create({ name: 'Worker B', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const memberA = await executeJson('team.member.spawn', {
      teamId: asRecord(team.team).id,
      agentId: workerA.id,
      name: 'A',
    })
    const memberB = await executeJson('team.member.spawn', {
      teamId: asRecord(team.team).id,
      agentId: workerB.id,
      name: 'B',
    })
    const task = taskStore.create({
      title: 'Owned by A',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(memberA.member).id as string,
      assignAgentId: workerA.id,
    })
    const handler = getRequiredHandler('team.task.update')

    await expect(
      handler.execute(
        { taskId: task.id, status: 'completed' },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(memberB.member).id as string,
          agentId: workerB.id,
        },
      ),
    ).rejects.toThrow('Team')
  })

  test('team.task.update rejects member reassigning their task', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const workerA = agentStore.create({ name: 'Worker A', type: 'dev', runtime: 'mock', projectId: project.id })
    const workerB = agentStore.create({ name: 'Worker B', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: leader.id })
    const memberA = await executeJson('team.member.spawn', {
      teamId: asRecord(team.team).id,
      agentId: workerA.id,
      name: 'A',
    })
    const memberB = await executeJson('team.member.spawn', {
      teamId: asRecord(team.team).id,
      agentId: workerB.id,
      name: 'B',
    })
    const task = taskStore.create({
      title: 'Owned by A',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(memberA.member).id as string,
      assignAgentId: workerA.id,
    })
    const handler = getRequiredHandler('team.task.update')

    await expect(
      handler.execute(
        { taskId: task.id, assigneeMemberId: asRecord(memberB.member).id },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(memberA.member).id as string,
          agentId: workerA.id,
        },
      ),
    ).rejects.toThrow('Team')
  })
  test('team.task.update normalizes common completion aliases to completed', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: 'Alias status',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(team.member).id as string,
    })

    const updated = await executeJson('team.task.update', {
      teamId: asRecord(team.team).id,
      taskId: task.id,
      status: 'done',
    })

    expect(asRecord(updated.task)).toMatchObject({ id: task.id, status: 'completed' })
    expect(taskStore.get(task.id)?.completed_at).toBeTruthy()
  })

  test('team.task.update clears completed_at when reopening a completed task', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: 'Reopen task',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(team.member).id as string,
    })

    await executeJson('team.task.update', {
      teamId: asRecord(team.team).id,
      taskId: task.id,
      status: 'completed',
    })
    expect(taskStore.get(task.id)?.completed_at).toBeTruthy()

    const reopened = await executeJson('team.task.update', {
      teamId: asRecord(team.team).id,
      taskId: task.id,
      status: 'in_progress',
      stage: '复审中',
    })

    expect(asRecord(reopened.task)).toMatchObject({
      id: task.id,
      status: 'in_progress',
      stage: '复审中',
      completed_at: null,
    })
    expect(taskStore.get(task.id)?.completed_at).toBeNull()
  })

  test('team.task.update can mark a team task completed', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: 'Implement test',
      source: 'agent',
      projectId: project.id,
      teamId: asRecord(team.team).id as string,
      assigneeMemberId: asRecord(team.member).id as string,
    })

    const updated = await executeJson('team.task.update', {
      teamId: asRecord(team.team).id,
      taskId: task.id,
      status: 'completed',
      stage: 'done',
    })

    expect(asRecord(updated.task)).toMatchObject({ id: task.id, status: 'completed', stage: 'done' })
    expect(taskStore.get(task.id)?.completed_at).toBeTruthy()
  })

  test('team.task.update clears assigned Agent when unassigning member', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Dev', type: 'dev', runtime: 'mock', projectId: project.id })
    const team = await executeJson('team.create', { name: 'Alpha' }, { projectId: project.id, agentId: agent.id })
    const task = taskStore.create({
      title: 'Unassign',
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

  test('Team Leader can create a team, spawn a member, dispatch work, and receive completion feedback', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({
      name: 'Claude Leader',
      type: 'architect',
      runtime: 'claude',
      projectId: project.id,
    })
    seedBuiltinTools()
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: leader.id })
    const sendPrompt = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    const created = await executeJson(
      'team.create',
      { name: 'Alpha', description: 'Closed loop Team' },
      {
        projectId: project.id,
        agentId: leader.id,
      },
    )
    const template = templateStore.create({
      name: 'Worker',
      type: 'dev',
      runtime: 'mock',
      systemPrompt: 'Do the small task and report back.',
    })
    const spawned = await executeJson(
      'team.member.spawn',
      {
        teamId: asRecord(created.team).id,
        templateId: template.id,
        role: 'member',
      },
      { projectId: project.id, agentId: leader.id },
    )
    const taskResult = await executeJson(
      'team.task.create',
      {
        teamId: asRecord(created.team).id,
        title: 'Say hello',
        description: 'Return hello and report completion.',
        assigneeMemberId: asRecord(spawned.member).id,
      },
      { projectId: project.id, agentId: leader.id },
    )

    const dispatch = await executeJson(
      'team.member.message',
      {
        teamId: asRecord(created.team).id,
        memberId: asRecord(spawned.member).id,
        taskId: asRecord(taskResult.task).id,
        content: 'Please finish the hello task, report by mailbox, and mark the task completed.',
      },
      { projectId: project.id, agentId: leader.id },
    )
    const feedback = await executeJson(
      'team.mailbox.send',
      {
        content: 'hello task completed',
        type: 'report',
        taskId: asRecord(taskResult.task).id,
      },
      {
        projectId: project.id,
        teamId: asRecord(created.team).id as string,
        teamMemberId: asRecord(spawned.member).id as string,
        agentId: asRecord(spawned.agent).id as string,
      },
    )
    const completed = await executeJson(
      'team.task.update',
      {
        taskId: asRecord(taskResult.task).id,
        status: 'completed',
        stage: 'member reported completion',
      },
      {
        projectId: project.id,
        teamId: asRecord(created.team).id as string,
        teamMemberId: asRecord(spawned.member).id as string,
        agentId: asRecord(spawned.agent).id as string,
      },
    )
    const detail = await executeJson(
      'team.get',
      { teamId: asRecord(created.team).id },
      { projectId: project.id, agentId: leader.id },
    )

    expect(dispatch.status).toBe('accepted')
    expect(sendPrompt).toHaveBeenCalledWith(
      asRecord(spawned.member).session_id,
      'Please finish the hello task, report by mailbox, and mark the task completed.',
      undefined,
      expect.objectContaining({
        senderRole: 'team-assignment',
        senderName: 'Master',
        modelContent: expect.stringContaining('Please finish the hello task'),
      }),
    )
    expect(asRecord(feedback.message)).toMatchObject({
      from_member_id: asRecord(spawned.member).id,
      task_id: asRecord(taskResult.task).id,
      content: 'hello task completed',
    })
    expect(asRecord(completed.task)).toMatchObject({
      id: asRecord(taskResult.task).id,
      status: 'completed',
      stage: 'member reported completion',
      assignee_member_id: asRecord(spawned.member).id,
      assigned_agent_id: asRecord(spawned.agent).id,
    })
    expect(detail.members as unknown[]).toHaveLength(2)
    expect(detail.tasks as unknown[]).toHaveLength(1)
    expect(detail.mailbox as unknown[]).toHaveLength(1)
  })

  test('Team tools reject access to another project team', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: tmp })
    const projectB = projectStore.create({ name: 'B', workDir: tmp })
    const agentA = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: projectA.id })
    const agentB = agentStore.create({ name: 'Agent B', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const teamB = await executeJson('team.create', { name: 'Beta' }, { projectId: projectB.id, agentId: agentB.id })
    const handler = getRequiredHandler('team.get')

    await expect(
      handler.execute({ teamId: asRecord(teamB.team).id }, { projectId: projectA.id, agentId: agentA.id }),
    ).rejects.toThrow('Team')
  })

  test('Team mailbox does not allow spoofing current member identity', async () => {
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

    await expect(
      handler.execute(
        {
          teamId: asRecord(team.team).id,
          fromMemberId: asRecord(member.member).id,
          content: 'spoof sender',
        },
        {
          projectId: project.id,
          teamId: asRecord(team.team).id as string,
          teamMemberId: asRecord(team.member).id as string,
        },
      ),
    ).rejects.toThrow('fromMemberId')
  })
})

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext = {},
): Promise<Record<string, unknown>> {
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
