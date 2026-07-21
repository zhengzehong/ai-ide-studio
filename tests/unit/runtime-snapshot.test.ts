import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRuntimeStateSnapshot } from '../../src/runtime/api/runtime-snapshot.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-runtime-snapshot-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('runtime state snapshot', () => {
  test('projects store state into a clone-safe runtime DTO', () => {
    const project = projectStore.create({ name: 'Runtime project', workDir: resolve(tmp, 'workspace') })
    const agent = agentStore.create({
      name: 'Runtime agent',
      type: 'developer',
      runtime: 'mock',
      projectId: project.id,
      systemPrompt: 'Follow the project contract.',
      config: { skills: ['typescript'] },
    })
    const session = sessionStore.create({
      agentId: agent.id,
      projectId: project.id,
      acpSessionId: 'acp-existing',
      isPrimary: true,
      title: 'Runtime session',
    })
    sessionStore.updateRuntimePreferences(session.id, {
      modelId: 'mock-smart',
      modeId: 'plan',
      config: { effort: 'high' },
    })
    const team = teamStore.create({ projectId: project.id, name: 'Runtime team' })
    const member = teamMemberStore.create({
      teamId: team.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      name: agent.name,
      role: 'leader',
    })

    const snapshot = buildRuntimeStateSnapshot({ sessionId: session.id })

    expect(snapshot.agent).toMatchObject({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      runtime: 'mock',
      projectId: project.id,
      permissionLevel: 3,
    })
    expect(snapshot.session).toMatchObject({
      id: session.id,
      agentId: agent.id,
      projectId: project.id,
      cwd: project.work_dir,
      acpSessionId: 'acp-existing',
      isPrimary: true,
    })
    expect(snapshot.runtimePreferences).toEqual({
      modelId: 'mock-smart',
      modeId: 'plan',
      config: { effort: 'high' },
    })
    expect(snapshot.runtime.env).toEqual(expect.any(Object))
    expect(snapshot.runtime.sessionMeta).toEqual(expect.objectContaining({ systemPrompt: expect.any(String) }))
    expect(snapshot.mcpServers).toEqual(expect.any(Array))
    expect(snapshot.team).toEqual({
      teamId: team.id,
      memberId: member.id,
      role: 'leader',
    })
    expect(() => structuredClone(snapshot)).not.toThrow()
    expect(JSON.stringify(snapshot)).not.toContain('config_json')
    expect(JSON.stringify(snapshot)).not.toContain('runtime_preferences_json')
  })

  test('rejects a missing or cross-project session graph', () => {
    expect(() => buildRuntimeStateSnapshot({ sessionId: 'missing' })).toThrow('Session not found')

    const project = projectStore.create({ name: 'Project A' })
    const otherProject = projectStore.create({ name: 'Project B' })
    const agent = agentStore.create({
      name: 'Wrong project agent',
      type: 'developer',
      runtime: 'mock',
      projectId: otherProject.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    expect(() => buildRuntimeStateSnapshot({ sessionId: session.id })).toThrow('project mismatch')
  })
})
