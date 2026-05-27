import { describe, test, expect, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { templateStore } from '../../src/store/agent-templates.js'
import { agentStore } from '../../src/store/agents.js'
import { deployTemplateToProject, deleteAgentTemplate } from '../../src/core/agents.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-template-deploy-'))
let dbIndex = 0

beforeEach(() => {
  closeDatabase()
  const dbDir = resolve(tmp, `case-${++dbIndex}`)
  mkdirSync(dbDir, { recursive: true })
  initDatabase(resolve(dbDir, 'test.sqlite'))
})

afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

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
    expect(agentStore.list(project.id).map(a => a.id)).toEqual([agent.id])
  })

  test('does not delete builtin templates through domain service', () => {
    const template = templateStore.create({ name: '内置', type: 'dev', isBuiltin: true })
    expect(() => deleteAgentTemplate(template.id)).toThrow('内置模板不能删除')
    expect(templateStore.get(template.id)).toBeTruthy()
  })
})
