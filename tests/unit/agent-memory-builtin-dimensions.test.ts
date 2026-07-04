import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { agentMemoryService, AGENT_MEMORY_MAX_DIMENSIONS } from '../../src/core/agent-memory.js'
import { agentMemoryDimensionStore } from '../../src/store/agent-memory-dimensions.js'
import { BUILTIN_MEMORY_DIMENSIONS } from '../../src/store/agent-memory-builtin-dimensions.js'
import { createCustomProjectAgent } from '../../src/core/agents.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-builtin-dims-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('builtin memory dimensions seed', () => {
  test('createCustomProjectAgent seeds 3 builtin dimensions', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = createCustomProjectAgent({
      projectId: project.id,
      name: 'A',
      type: 'dev',
      runtime: 'mock',
    })

    const dims = agentMemoryService.listDimensions(project.id, agent.id)
    expect(dims.length).toBe(3)
    const names = dims.map((d) => d.name).sort()
    expect(names).toEqual(['facts', 'lessons', 'preferences'])
    for (const d of dims) {
      expect(d.is_builtin).toBe(1)
    }
  })

  test('seed is idempotent — already-existing same-name dimension is skipped', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
    agentMemoryDimensionStore.create({
      projectId: project.id,
      agentId: agent.id,
      name: 'lessons',
      description: 'user-defined',
      prompt: 'custom',
    })

    const created = agentMemoryService.seedBuiltinDimensions(project.id, agent.id)
    expect(created.length).toBe(2)
    expect(created.map((d) => d.name).sort()).toEqual(['facts', 'preferences'])

    const lessons = agentMemoryDimensionStore.getByNames(project.id, agent.id, 'lessons')!
    expect(lessons.is_builtin).toBe(0)
    expect(lessons.prompt).toBe('custom')
  })

  test('seedBuiltinDimensions failure does not throw (returns partial)', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
    const before = agentMemoryDimensionStore.countByAgent(project.id, agent.id)
    expect(before).toBe(0)
    const created = agentMemoryService.seedBuiltinDimensions(project.id, agent.id)
    expect(created.length).toBe(3)
  })

  test('BUILTIN_MEMORY_DIMENSIONS exports exactly 3 dimensions with correct names', () => {
    expect(BUILTIN_MEMORY_DIMENSIONS.length).toBe(3)
    const names = BUILTIN_MEMORY_DIMENSIONS.map((d) => d.name).sort()
    expect(names).toEqual(['facts', 'lessons', 'preferences'])
    for (const d of BUILTIN_MEMORY_DIMENSIONS) {
      expect(d.description.length).toBeGreaterThan(0)
      expect(d.prompt.length).toBeGreaterThan(0)
    }
  })
})

describe('builtin dimension protection and limit', () => {
  test('deleteDimension rejects builtin dimension with BUILTIN_DIMENSION_CANNOT_DELETE', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
    agentMemoryService.seedBuiltinDimensions(project.id, agent.id)
    const lessons = agentMemoryDimensionStore.getByNames(project.id, agent.id, 'lessons')!

    expect(() =>
      agentMemoryService.deleteDimension({ projectId: project.id, agentId: agent.id, dimensionId: lessons.id }),
    ).toThrow('BUILTIN_DIMENSION_CANNOT_DELETE')
  })

  test('builtin dimensions do not count against custom limit (10 custom still allowed)', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
    agentMemoryService.seedBuiltinDimensions(project.id, agent.id)

    for (let i = 0; i < AGENT_MEMORY_MAX_DIMENSIONS; i++) {
      agentMemoryService.defineDimension({
        projectId: project.id,
        agentId: agent.id,
        name: `custom-${i}`,
        description: 'user dim',
        prompt: 'prompt',
      })
    }

    const dims = agentMemoryService.listDimensions(project.id, agent.id)
    expect(dims.length).toBe(AGENT_MEMORY_MAX_DIMENSIONS + 3)

    expect(() =>
      agentMemoryService.defineDimension({
        projectId: project.id,
        agentId: agent.id,
        name: 'overflow',
        description: 'over',
        prompt: 'xxx',
      }),
    ).toThrow('DIMENSION_LIMIT_EXCEEDED')
  })

  test('countCustomByAgent only counts non-builtin dimensions', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
    agentMemoryService.seedBuiltinDimensions(project.id, agent.id)
    expect(agentMemoryDimensionStore.countCustomByAgent(project.id, agent.id)).toBe(0)

    agentMemoryService.defineDimension({
      projectId: project.id,
      agentId: agent.id,
      name: 'extra',
      description: 'd',
      prompt: 'p',
    })
    expect(agentMemoryDimensionStore.countCustomByAgent(project.id, agent.id)).toBe(1)
    expect(agentMemoryDimensionStore.countByAgent(project.id, agent.id)).toBe(4)
  })
})
