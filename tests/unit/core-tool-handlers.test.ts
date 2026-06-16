import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { templateStore } from '../../src/store/agent-templates.js'
import { taskStore } from '../../src/store/tasks.js'
import { ruleStore } from '../../src/store/rules.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { acpHost } from '../../src/acp/host.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-core-tools-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('core MCP tool handlers', () => {
  test('creates, lists, and gets projects', async () => {
    const created = await executeJson('core.project.create', { name: '平台', workDir: tmp, description: '核心项目' })
    expect(asRecord(created.project)).toMatchObject({ name: '平台', work_dir: tmp, description: '核心项目' })

    const listed = await executeJson('core.project.list', {})
    const projects = asRecords(listed.projects)
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe(asRecord(created.project).id)

    const got = await executeJson('core.project.get', { projectId: asRecord(created.project).id })
    expect(asRecord(got.project).id).toBe(asRecord(created.project).id)
  })

  test('creates custom agents in the current project when projectId is omitted', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })

    const created = await executeJson(
      'core.agent.create',
      { name: 'Dev', type: 'dev', runtime: 'mock' },
      { projectId: project.id },
    )
    expect(asRecord(created.agent)).toMatchObject({ name: 'Dev', type: 'dev', runtime: 'mock', project_id: project.id })

    const listed = await executeJson('core.agent.list', {}, { projectId: project.id })
    expect(asRecords(listed.agents).map((agent) => agent.id)).toEqual([asRecord(created.agent).id])

    const got = await executeJson('core.agent.get', { agentId: asRecord(created.agent).id })
    expect(asRecord(got.agent).id).toBe(asRecord(created.agent).id)
  })

  test('creates agents from templates', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const template = templateStore.create({
      name: '模板工程师',
      type: 'dev',
      runtime: 'mock',
      systemPrompt: '按规范工作',
    })

    const created = await executeJson('core.agent.create', { templateId: template.id }, { projectId: project.id })

    expect(asRecord(created.agent)).toMatchObject({
      name: '模板工程师',
      type: 'dev',
      runtime: 'mock',
      project_id: project.id,
      template_id: template.id,
    })
  })

  test('creates custom and template agents with model profiles', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const profile = modelProfileStore.create({
      name: 'Codex Profile',
      runtime: 'codex',
      providerId: provider.id,
      config: { model: 'deepseek-v4-flash', effort: 'medium' },
    })
    const template = templateStore.create({
      name: '模板 Codex',
      type: 'dev',
      runtime: 'codex',
      systemPrompt: '按规范工作',
    })

    const custom = await executeJson(
      'core.agent.create',
      { name: 'Codex Dev', type: 'dev', runtime: 'codex', modelProfileId: profile.id },
      { projectId: project.id },
    )
    const fromTemplate = await executeJson(
      'core.agent.create',
      { templateId: template.id, modelProfileId: profile.id },
      { projectId: project.id },
    )

    expect(readAgentConfig(asRecord(custom.agent)).modelProfileId).toBe(profile.id)
    expect(readAgentConfig(asRecord(fromTemplate.agent)).modelProfileId).toBe(profile.id)
  })

  test('lists model profiles through a core MCP tool', async () => {
    const provider = modelProviderStore.create({
      name: 'new-api',
      displayName: 'New API',
      protocol: 'new-api',
      baseUrl: 'http://127.0.0.1:29000',
      apiKey: 'sk-test',
    })
    const claudeProfile = modelProfileStore.create({
      name: 'Claude Profile',
      runtime: 'claude',
      providerId: provider.id,
      config: { defaultModel: 'deepseek-v4-pro' },
    })
    modelProfileStore.create({
      name: 'Disabled Claude Profile',
      runtime: 'claude',
      providerId: provider.id,
      config: { defaultModel: 'deepseek-v4-flash' },
      enabled: false,
    })
    modelProfileStore.create({
      name: 'Codex Profile',
      runtime: 'codex',
      providerId: provider.id,
      config: { model: 'deepseek-v4-flash', effort: 'medium' },
    })

    const listed = await executeJson('core.model_profile.list', { runtime: 'claude', enabledOnly: true })

    expect(asRecords(listed.profiles).map((profile) => profile.id)).toEqual([claudeProfile.id])
  })

  test('creates, lists, and gets sessions through the session manager', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock', projectId: project.id })

    try {
      const created = await executeJson('core.session.create', { agentId: agent.id }, { projectId: project.id })
      expect(asRecord(created.session)).toMatchObject({
        agent_id: agent.id,
        project_id: project.id,
        status: 'active',
        acp_session_id: null,
      })

      const listed = await executeJson('core.session.list', {}, { projectId: project.id })
      expect(asRecords(listed.sessions).map((session) => session.id)).toEqual([asRecord(created.session).id])

      const got = await executeJson('core.session.get', { sessionId: asRecord(created.session).id })
      expect(asRecord(got.session).id).toBe(asRecord(created.session).id)
    } finally {
      acpHost.agents.delete(agent.id)
    }
  })

  test('legacy create_task keeps the old response shape', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })

    const created = await executeJson('create_task', { title: 'Legacy task' }, { projectId: project.id })

    expect(Object.keys(created).sort()).toEqual(['status', 'taskId', 'title'])
    expect(created.title).toBe('Legacy task')
    expect(created.status).toBe('backlog')
    expect(typeof created.taskId).toBe('string')
  })

  test('project-scoped tools use context projectId before model-provided projectId', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'B', workDir: resolve(tmp, 'b') })
    taskStore.create({ title: 'A task', source: 'human', projectId: projectA.id })
    taskStore.create({ title: 'B task', source: 'human', projectId: projectB.id })

    const agent = await executeJson(
      'core.agent.create',
      { name: 'Dev', type: 'dev', runtime: 'mock', projectId: projectB.id },
      { projectId: projectA.id },
    )
    expect(asRecord(agent.agent).project_id).toBe(projectA.id)

    const created = await executeJson(
      'core.task.create',
      { title: 'Context task', projectId: projectB.id },
      { projectId: projectA.id },
    )
    expect(asRecord(created.task).project_id).toBe(projectA.id)

    const listed = await executeJson('core.task.list', { projectId: projectB.id }, { projectId: projectA.id })
    expect(asRecords(listed.tasks).map((task) => task.title)).toEqual(['A task', 'Context task'])
  })

  test('core.session.create rejects target agents outside the current project', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'B', workDir: resolve(tmp, 'b') })
    const agentB = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const handler = getHandler('core.session.create')
    if (!handler) throw new Error('handler missing: core.session.create')

    await expect(
      handler.execute({ agentId: agentB.id, projectId: projectB.id }, { projectId: projectA.id }),
    ).rejects.toThrow('Project')
  })

  test('core.task.create rejects assigned agents outside the current project before creating task rows', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'B', workDir: resolve(tmp, 'b') })
    const agentB = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: projectB.id })
    const handler = getHandler('core.task.create')
    if (!handler) throw new Error('handler missing: core.task.create')

    await expect(
      handler.execute(
        { title: 'Cross project', assignAgentId: agentB.id, projectId: projectB.id },
        { projectId: projectA.id },
      ),
    ).rejects.toThrow('Project')
    expect(taskStore.list(undefined, projectA.id)).toHaveLength(0)
  })

  test('studio.schedule.create stores explicit session target for scheduled tasks and prompts', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Scheduler', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    const taskRule = await executeJson(
      'studio.schedule.create',
      {
        name: 'Task reuse',
        cron: '0 9 * * *',
        action: 'create_task',
        taskTitle: 'Daily task',
        assignAgentId: agent.id,
        sessionId: session.id,
      },
      { projectId: project.id },
    )
    const storedTaskRule = ruleStore.get(taskRule.ruleId as string)
    expect(storedTaskRule?.action_config).toMatchObject({ assign_agent_id: agent.id, session_id: session.id })

    const promptRule = await executeJson(
      'studio.schedule.create',
      {
        name: 'Prompt reuse',
        cron: '0 10 * * *',
        action: 'send_prompt',
        prompt: 'daily check',
        agentId: agent.id,
        sessionId: session.id,
      },
      { projectId: project.id },
    )
    const storedPromptRule = ruleStore.get(promptRule.ruleId as string)
    expect(storedPromptRule?.action_config).toMatchObject({ agent_id: agent.id, session_id: session.id })
  })

  test('studio.schedule.create stores explicit session mode for scheduled tasks and prompts', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Scheduler', type: 'dev', runtime: 'mock', projectId: project.id })

    const taskRule = await executeJson(
      'studio.schedule.create',
      {
        name: 'Task fixed',
        cron: '0 9 * * *',
        action: 'create_task',
        taskTitle: 'Daily task',
        assignAgentId: agent.id,
        sessionMode: 'new_fixed',
      },
      { projectId: project.id },
    )
    const storedTaskRule = ruleStore.get(taskRule.ruleId as string)
    expect(storedTaskRule?.action_config).toMatchObject({ assign_agent_id: agent.id, session_mode: 'new_fixed' })

    const promptRule = await executeJson(
      'studio.schedule.create',
      {
        name: 'Prompt fixed',
        cron: '0 10 * * *',
        action: 'send_prompt',
        prompt: 'daily check',
        agentId: agent.id,
        sessionMode: 'new_fixed',
      },
      { projectId: project.id },
    )
    const storedPromptRule = ruleStore.get(promptRule.ruleId as string)
    expect(storedPromptRule?.action_config).toMatchObject({ agent_id: agent.id, session_mode: 'new_fixed' })
  })

  test('studio.schedule.update stores explicit session target', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Scheduler', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const rule = ruleStore.create({
      name: 'Rule',
      cron: '0 9 * * *',
      action: 'create_task',
      projectId: project.id,
      actionConfig: { title: 'Before', assign_agent_id: agent.id },
    })

    await executeJson('studio.schedule.update', {
      ruleId: rule.id,
      sessionId: session.id,
    })

    expect(ruleStore.get(rule.id)?.action_config).toMatchObject({ session_id: session.id })
  })
})

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext = {},
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value.map(asRecord)
}

function readAgentConfig(agent: Record<string, unknown>): Record<string, unknown> {
  const raw = agent.config_json
  if (typeof raw !== 'string') return {}
  const parsed = JSON.parse(raw) as unknown
  return asRecord(parsed)
}
