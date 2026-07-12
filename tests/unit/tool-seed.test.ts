import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { createToolContext } from '../../src/tools/registry/context-registry.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-seed-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('builtin tool seed synchronization', () => {
  test('adds core tools even when older builtin rows already exist', () => {
    for (const name of [
      'create_task',
      'create_schedule',
      'search_files',
      'get_project_info',
      'list_agents',
      'http_fetch',
    ]) {
      const tool = toolStore.create({
        name,
        displayName: name,
        description: name,
        category: 'automation',
        type: 'builtin',
        config: { handler: legacyHandlerName(name) },
        inputSchema: { type: 'object', properties: {} },
        permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
        isBuiltin: true,
      })
      toolBindingStore.set(tool.id, 'global', null)
    }

    seedBuiltinTools()

    const names = getDb()
      .prepare<[], { name: string }>('SELECT name FROM tools ORDER BY name')
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
      'agent_hub.connect',
      'agent_hub.disconnect',
      'agent_hub.list',
      'agent_hub.send',
      'agent_hub.upload_file',
      'agent_memory.seed_builtin',
      'core.agent.create',
      'core.agent.get',
      'core.agent.list',
      'core.kb.create_kb',
      'core.kb.create_page',
      'core.kb.list',
      'core.kb.mount',
      'core.kb.read_index',
      'core.kb.read_page',
      'core.kb.refresh_from_code',
      'core.kb.revert',
      'core.kb.search',
      'core.kb.unmount',
      'core.kb.update_page',
      'core.model_profile.list',
      'core.project.create',
      'core.project.get',
      'core.project.list',
      'core.session.create',
      'core.session.get',
      'core.session.list',
      'core.session.template.delete',
      'core.session.template.instantiate',
      'core.session.template.list',
      'core.session.template.publish',
      'core.task.create',
      'core.task.list',
      'core.timeline.list',
      'create_schedule',
      'create_task',
      'define_memory_dimension',
      'delete_memory',
      'event.category.create',
      'event.category.list',
      'event.category.update',
      'event.claim_next',
      'event.consume',
      'event.convert_to_task',
      'event.create',
      'event.get',
      'event.ignore',
      'event.list',
      'event.subscription.create',
      'get_memory',
      'list_memory',
      'preview.publish',
      'recall_memory',
      'record_memory',
      'studio.schedule.create',
      'studio.schedule.delete',
      'studio.schedule.executions',
      'studio.schedule.list',
      'studio.schedule.toggle',
      'studio.schedule.update',
      'studio.task.assign',
      'studio.task.create',
      'studio.task.createSimple',
      'studio.task.get',
      'studio.task.list',
      'studio.task.report',
      'studio.task.start',
      'studio.task.step.add',
      'studio.task.step.get',
      'studio.task.step.remove',
      'studio.task.step.report',
      'studio.task.step.update',
      'studio.task.step.updateProgress',
      'studio.task.update',
      'studio.task.update_progress',
      'team.create',
      'team.get',
      'team.list',
      'team.mailbox.list',
      'team.mailbox.send',
      'team.member.list',
      'team.member.message',
      'team.member.spawn',
      'team.task.create',
      'team.task.list',
      'team.task.update',
      'team.template.describe',
      'team.template.list',
      'team.update',
      'update_memory',
    ])

    const globalBindings = getDb()
      .prepare<[], { name: string }>(
        `
      SELECT tools.name FROM tools
      JOIN tool_bindings ON tool_bindings.tool_id = tools.id
      WHERE tool_bindings.scope = 'global' AND tool_bindings.enabled = 1
      ORDER BY tools.name
    `,
      )
      .all()
      .map((row) => row.name)
    expect(globalBindings).toEqual(names.filter((name) => !name.startsWith('team.')))
    expect(names.filter((name) => name.startsWith('team.')).length).toBeGreaterThan(0)

    const createAgent = toolStore.getByName('core.agent.create')
    const createAgentSchema = createAgent?.input_schema_json
      ? (JSON.parse(createAgent.input_schema_json) as Record<string, unknown>)
      : {}
    const createAgentProperties = asRecord(createAgentSchema.properties)
    expect(createAgentProperties.modelProfileId).toMatchObject({ type: 'string' })

    const createTemplate = toolStore.getByName('agent.template.create')
    const createTemplateSchema = createTemplate?.input_schema_json
      ? (JSON.parse(createTemplate.input_schema_json) as Record<string, unknown>)
      : {}
    const createTemplateProperties = asRecord(createTemplateSchema.properties)
    expect(createTemplateProperties.systemPrompt).toMatchObject({ type: 'string' })
    expect(createTemplateProperties.skills).toMatchObject({ type: 'array' })

    const updateTemplate = toolStore.getByName('agent.template.update')
    const updateTemplateSchema = updateTemplate?.input_schema_json
      ? (JSON.parse(updateTemplate.input_schema_json) as Record<string, unknown>)
      : {}
    const updateTemplateProperties = asRecord(updateTemplateSchema.properties)
    expect(updateTemplateProperties.templateId).toMatchObject({ type: 'string' })

    const eventSubscription = toolStore.getByName('event.subscription.create')
    const eventSubscriptionSchema = eventSubscription?.input_schema_json
      ? (JSON.parse(eventSubscription.input_schema_json) as Record<string, unknown>)
      : {}
    const eventSubscriptionProperties = asRecord(eventSubscriptionSchema.properties)
    expect(eventSubscriptionProperties.autoStart).toMatchObject({ type: 'boolean' })
    expect(eventSubscriptionProperties.consumerSessionMode).toMatchObject({
      enum: ['existing', 'new_each', 'new_fixed'],
    })
    expect(eventSubscriptionProperties.consumerSessionId).toMatchObject({ type: 'string' })

    const studioTaskCreate = toolStore.getByName('studio.task.create')
    const studioTaskCreateSchema = studioTaskCreate?.input_schema_json
      ? (JSON.parse(studioTaskCreate.input_schema_json) as Record<string, unknown>)
      : {}
    const studioTaskCreateProperties = asRecord(studioTaskCreateSchema.properties)
    expect(Object.keys(studioTaskCreateProperties).sort()).toEqual(['description', 'title'])
    expect(studioTaskCreateSchema.required).toEqual(['title', 'description'])
    expect(studioTaskCreateProperties.description).toMatchObject({ type: 'string' })

    const studioTaskCreateSimple = toolStore.getByName('studio.task.createSimple')
    const studioTaskCreateSimpleSchema = studioTaskCreateSimple?.input_schema_json
      ? (JSON.parse(studioTaskCreateSimple.input_schema_json) as Record<string, unknown>)
      : {}
    const studioTaskCreateSimpleProperties = asRecord(studioTaskCreateSimpleSchema.properties)
    expect(Object.keys(studioTaskCreateSimpleProperties).sort()).toEqual([
      'assignee',
      'description',
      'selfExecute',
      'sessionId',
      'title',
    ])
    expect(studioTaskCreateSimpleSchema.required).toEqual(['title', 'description'])
    expect(studioTaskCreateSimpleProperties.selfExecute).toMatchObject({ type: 'boolean', default: false })

    const studioScheduleCreate = toolStore.getByName('studio.schedule.create')
    const studioScheduleCreateSchema = studioScheduleCreate?.input_schema_json
      ? (JSON.parse(studioScheduleCreate.input_schema_json) as Record<string, unknown>)
      : {}
    const studioScheduleCreateProperties = asRecord(studioScheduleCreateSchema.properties)
    expect(studioScheduleCreateProperties.sessionMode).toMatchObject({ enum: ['existing', 'new_each', 'new_fixed'] })
    expect(studioScheduleCreateProperties.sessionId).toMatchObject({ type: 'string' })
  })

  test('removes stale global team tool bindings when reseeding', () => {
    seedBuiltinTools()
    const teamCreate = toolStore.getByName('team.create')
    if (!teamCreate) throw new Error('team.create missing')
    toolBindingStore.set(teamCreate.id, 'global', null)

    seedBuiltinTools()

    const teamGlobalBindings = getDb()
      .prepare<[], { count: number }>(
        `
      SELECT COUNT(*) AS count FROM tool_bindings
      JOIN tools ON tools.id = tool_bindings.tool_id
      WHERE tools.name LIKE 'team.%'
        AND tool_bindings.scope = 'global'
        AND tool_bindings.target_id IS NULL
        AND tool_bindings.enabled = 1
    `,
      )
      .get()
    expect(teamGlobalBindings?.count).toBe(0)
  })

  test('registers preview.publish as a global builtin tool', () => {
    seedBuiltinTools()

    const tool = toolStore.getByName('preview.publish')
    expect(tool).toBeDefined()
    expect(tool?.is_builtin).toBe(1)
    expect(tool?.type).toBe('builtin')
    expect(tool?.category).toBe('automation')

    const config = tool?.config_json ? (JSON.parse(tool.config_json) as Record<string, unknown>) : {}
    expect(config.handler).toBe('preview.publish')

    const schema = tool?.input_schema_json ? (JSON.parse(tool.input_schema_json) as Record<string, unknown>) : {}
    const properties = asRecord(schema.properties)
    expect(properties.sourcePath).toMatchObject({ type: 'string' })
    expect(properties.target).toMatchObject({ enum: ['pc', 'app'] })
    expect(properties.entryFile).toMatchObject({ type: 'string' })
    expect(schema.required).toEqual(['sourcePath'])

    const bindings = getDb()
      .prepare<{ name: string }, { name: string }>(
        `
      SELECT tools.name FROM tools
      JOIN tool_bindings ON tool_bindings.tool_id = tools.id
      WHERE tools.name = 'preview.publish'
        AND tool_bindings.scope = 'global'
        AND tool_bindings.enabled = 1
    `,
      )
      .all()
    expect(bindings).toHaveLength(1)
  })

  test('registers core.session.template.* as global builtin tools', () => {
    seedBuiltinTools()

    const expected = [
      'core.session.template.list',
      'core.session.template.publish',
      'core.session.template.instantiate',
      'core.session.template.delete',
    ]
    for (const name of expected) {
      const tool = toolStore.getByName(name)
      expect(tool, `expected tool ${name} to be seeded`).toBeDefined()
      expect(tool?.is_builtin).toBe(1)
      expect(tool?.type).toBe('builtin')

      const config = tool?.config_json ? (JSON.parse(tool.config_json) as Record<string, unknown>) : {}
      expect(config.handler).toBe(name)

      const bindings = getDb()
        .prepare<{ name: string }, { name: string }>(
          `
        SELECT tools.name FROM tools
        JOIN tool_bindings ON tool_bindings.tool_id = tools.id
        WHERE tools.name = ?
          AND tool_bindings.scope = 'global'
          AND tool_bindings.enabled = 1
      `,
        )
        .all(name)
      expect(bindings, `expected global binding for ${name}`).toHaveLength(1)
    }

    const publishTool = toolStore.getByName('core.session.template.publish')
    const publishSchema = publishTool?.input_schema_json
      ? (JSON.parse(publishTool.input_schema_json) as Record<string, unknown>)
      : {}
    const publishProps = asRecord(publishSchema.properties)
    expect(publishProps.sessionId).toMatchObject({ type: 'string' })
    expect(publishProps.name).toMatchObject({ type: 'string' })
    expect(publishProps.description).toMatchObject({ type: 'string' })
    expect(publishSchema.required).toEqual(['sessionId', 'name'])

    const instantiateTool = toolStore.getByName('core.session.template.instantiate')
    const instantiateSchema = instantiateTool?.input_schema_json
      ? (JSON.parse(instantiateTool.input_schema_json) as Record<string, unknown>)
      : {}
    expect(instantiateSchema.required).toEqual(['templateId'])
  })

  test('removes obsolete broken tools and revokes stale tool contexts', () => {
    const staleTool = toolStore.create({
      name: 'get_project_info',
      displayName: 'get_project_info',
      description: 'stale',
      category: 'data',
      type: 'builtin',
      config: { handler: 'getProjectInfo' },
      inputSchema: { type: 'object', properties: {} },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(staleTool.id, 'global', null)
    createToolContext({
      sessionId: 'sess-stale',
      agentId: 'agent-stale',
      visibleTools: ['create_task', 'get_project_info'],
    })

    seedBuiltinTools()

    expect(toolStore.getByName('get_project_info')).toBeUndefined()
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM tool_bindings WHERE tool_id = ?').get(staleTool.id)).toEqual({
      count: 0,
    })
    expect(
      getDb()
        .prepare<[], { revoked_at: string | null }>('SELECT revoked_at FROM tool_contexts WHERE session_id = ?')
        .get('sess-stale')?.revoked_at,
    ).toBeTruthy()
  })
})

function legacyHandlerName(name: string): string {
  const handlers: Record<string, string> = {
    create_task: 'createTask',
    create_schedule: 'createSchedule',
    search_files: 'searchFiles',
    get_project_info: 'getProjectInfo',
    list_agents: 'listAgents',
    http_fetch: 'httpFetch',
  }
  return handlers[name] ?? name
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object')
  return value as Record<string, unknown>
}
