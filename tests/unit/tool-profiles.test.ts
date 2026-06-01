import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { toolStore, toolBindingStore } from '../../src/store/tools.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { applyToolProfileToAgent, getToolProfile } from '../../src/tools/team-profiles.js'
import { resolveVisiblePlatformTools } from '../../src/tools/registry/visibility-resolver.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-tool-profiles-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('team tool profiles', () => {
  test('leader profile binds orchestration team tools to one agent', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
    const other = agentStore.create({ name: 'Other', type: 'dev', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()

    const applied = applyToolProfileToAgent({ profileId: 'team-leader', agentId: leader.id })

    expect(applied.profile.id).toBe('team-leader')
    expect(applied.boundToolNames).toEqual(getToolProfile('team-leader')?.toolNames)
    expect(
      resolveVisiblePlatformTools({ agentId: leader.id, projectId: project.id }).map((t) => t.definition.name),
    ).toEqual(expect.arrayContaining(['team.create', 'team.member.spawn', 'team.member.message', 'team.mailbox.send']))
    expect(
      resolveVisiblePlatformTools({ agentId: other.id, projectId: project.id }).map((t) => t.definition.name),
    ).not.toContain('team.create')
  })

  test('readonly profile replaces previous team tool bindings but keeps non-team bindings', () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: project.id })
    seedBuiltinTools()
    const custom = toolStore.create({
      name: 'custom.visible',
      displayName: 'Custom',
      description: 'Custom',
      category: 'custom',
      type: 'script',
      config: { scriptPath: resolve(tmp, 'custom.mjs'), runtime: 'node' },
      permissions: { requiresApproval: false, allowedPaths: [tmp], maxExecutionTime: 1000, networkAccess: false },
    })
    toolBindingStore.set(custom.id, 'agent', agent.id)
    applyToolProfileToAgent({ profileId: 'team-leader', agentId: agent.id })

    applyToolProfileToAgent({ profileId: 'team-readonly', agentId: agent.id })

    const visibleNames = resolveVisiblePlatformTools({ agentId: agent.id, projectId: project.id })
      .map((t) => t.definition.name)
      .sort()
    const teamVisibleNames = visibleNames.filter((name) => name.startsWith('team.'))
    expect(teamVisibleNames).toEqual([...getToolProfile('team-readonly')!.toolNames].sort())
    expect(visibleNames).toContain('custom.visible')
  })
})
