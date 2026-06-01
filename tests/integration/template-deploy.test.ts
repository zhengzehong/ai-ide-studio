import { describe, test, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { templateStore } from '../../src/store/agent-templates.js'
import { agentStore } from '../../src/store/agents.js'
import { deployTemplateToProject, deleteAgentTemplate } from '../../src/core/agents.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { seedBuiltinTemplates } from '../../src/store/agent-templates.js'
import { getToolProfile } from '../../src/tools/team-profiles.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-template-deploy-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('template deployment', () => {
  test('deploys a global template as a project scoped agent instance', () => {
    const project = projectStore.create({ name: '项目', workDir: resolve(tmp, 'project') })
    const template = templateStore.create({
      name: '架构师',
      type: 'architect',
      runtime: 'claude',
      icon: 'brain',
      systemPrompt: '你是架构师',
      skills: ['系统设计'],
      isBuiltin: true,
    })

    const agent = deployTemplateToProject(template.id, project.id)

    expect(agent.project_id).toBe(project.id)
    expect(agent.template_id).toBe(template.id)
    expect(agent.name).toBe('架构师')
    expect(agent.type).toBe('architect')
    expect(agent.runtime).toBe('claude')
    expect(agent.icon).toBe('brain')
    expect(agent.system_prompt).toBe('你是架构师')
    expect(agentStore.list(project.id).map((a) => a.id)).toEqual([agent.id])
  })

  test('seeds builtin templates idempotently', () => {
    seedBuiltinTemplates()
    seedBuiltinTemplates()

    const builtins = templateStore.list().filter((template) => template.is_builtin === 1)
    expect(builtins.map((template) => template.id).sort()).toEqual([
      'tpl-architect',
      'tpl-dev',
      'tpl-docs',
      'tpl-ops',
      'tpl-reviewer',
      'tpl-team-leader',
      'tpl-tester',
    ])

    const groups = getDb()
      .prepare<[], { count: number }>(
        `
      SELECT COUNT(*) AS count
      FROM (
        SELECT name, type, runtime, is_builtin, COUNT(*) AS total
        FROM agent_templates
        WHERE is_builtin = 1
        GROUP BY name, type, runtime, is_builtin
        HAVING total > 1
      )
    `,
      )
      .get()

    expect(groups?.count ?? 0).toBe(0)
  })

  test('seeds official Team Leader template and binds leader tools on deployment', () => {
    const project = projectStore.create({ name: '项目', workDir: resolve(tmp, 'project-leader') })
    seedBuiltinTools()
    seedBuiltinTemplates()

    const template = templateStore.get('tpl-team-leader')
    expect(template).toMatchObject({
      id: 'tpl-team-leader',
      name: '正式 Team Leader',
      type: 'leader',
      runtime: 'claude',
      icon: 'users',
      is_builtin: 1,
    })

    const agent = deployTemplateToProject('tpl-team-leader', project.id)

    expect(agent.project_id).toBe(project.id)
    expect(agent.template_id).toBe('tpl-team-leader')
    expect(agent.type).toBe('leader')
    expect(agent.runtime).toBe('claude')
    expect(agent.system_prompt).toContain('不要代替成员伪造 report')

    const boundToolNames = getDb()
      .prepare<[string], { name: string }>(
        `
      SELECT tools.name FROM tools
      JOIN tool_bindings ON tool_bindings.tool_id = tools.id
      WHERE tool_bindings.scope = 'agent'
        AND tool_bindings.target_id = ?
        AND tool_bindings.enabled = 1
      ORDER BY tools.name
    `,
      )
      .all(agent.id)
      .map((row) => row.name)
    expect(boundToolNames).toEqual([...getToolProfile('team-leader')!.toolNames].sort())
  })
  test('does not delete builtin templates through domain service', () => {
    const template = templateStore.create({ name: '内置', type: 'dev', isBuiltin: true })
    expect(() => deleteAgentTemplate(template.id)).toThrow('内置模板不能删除')
    expect(templateStore.get(template.id)).toBeTruthy()
  })
})
