import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRuntimeStateSnapshot } from '../../src/runtime/api/runtime-snapshot.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'
import { toolBindingStore, toolStore } from '../../src/store/tools.js'
import { setRuntimePort } from '../../src/runtime/runtime-port-provider.js'
import { ensureAutonomyMemory } from '../../src/core/agent-autonomy-memory.js'
import { updateAgentAutonomyConfig } from '../../src/core/agent-autonomy-config.js'

let tmp: string
let resetRuntimePort: (() => void) | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-runtime-snapshot-'))
  mkdirSync(tmp, { recursive: true })
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  resetRuntimePort?.()
  resetRuntimePort = undefined
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

  test('injects the independent prompt only into an autonomy Session', () => {
    const project = projectStore.create({ name: 'Autonomy project', workDir: tmp })
    const agent = agentStore.create({
      name: 'Autonomy agent',
      type: 'pm',
      runtime: 'mock',
      projectId: project.id,
      systemPrompt: 'Shared role prompt.',
    })
    const normal = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const autonomy = sessionStore.create({ agentId: agent.id, projectId: project.id, purpose: 'autonomy' })
    const memory = ensureAutonomyMemory(project.id, agent.id)
    updateAgentAutonomyConfig(agent.id, {
      prompt: 'Only investigate product risks.',
      memoryPath: memory.path,
      autonomySessionId: autonomy.id,
    })

    const normalSnapshot = buildRuntimeStateSnapshot({ sessionId: normal.id })
    const autonomySnapshot = buildRuntimeStateSnapshot({ sessionId: autonomy.id })

    expect(normalSnapshot.session.purpose).toBe('conversation')
    expect(JSON.stringify(normalSnapshot.runtime.sessionMeta)).not.toContain('Only investigate product risks.')
    expect(autonomySnapshot.session.purpose).toBe('autonomy')
    const systemPrompt = autonomySnapshot.runtime.sessionMeta?.systemPrompt
    expect(systemPrompt).toEqual(expect.any(String))
    expect(systemPrompt as string).toContain('Only investigate product risks.')
    expect(systemPrompt as string).toContain(memory.path)
  })

  test('uses the active process Runtime HTTP MCP transport without caller flags', () => {
    const project = projectStore.create({ name: 'Process project', workDir: tmp })
    const agent = agentStore.create({
      name: 'Process agent',
      type: 'developer',
      runtime: 'codex',
      projectId: project.id,
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    const tool = toolStore.create({
      name: 'core.task.list',
      displayName: 'List tasks',
      description: 'List tasks',
      category: 'automation',
      type: 'builtin',
      config: { handler: 'core.task.list' },
      permissions: { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false },
      isBuiltin: true,
    })
    toolBindingStore.set(tool.id, 'global', null)
    resetRuntimePort = setRuntimePort({
      platformToolTransport: { type: 'http', baseUrl: 'http://127.0.0.1:18900' },
      ensureSession: async () => 'acp-process',
      prompt: async () => undefined,
      cancelPrompt: async () => ({ status: 'not-active' as const }),
      closeSession: async () => undefined,
      forkSession: async () => 'acp-fork',
      setModel: async () => undefined,
      setMode: async () => undefined,
      setConfig: async () => undefined,
      getSessionCapabilities: async () => undefined,
      resolvePermission: async () => true,
      resolveElicitation: async () => true,
      drain: async () => undefined,
      close: async () => undefined,
    })

    const snapshot = buildRuntimeStateSnapshot({ sessionId: session.id })

    expect(snapshot.mcpServers).toEqual([
      expect.objectContaining({
        type: 'http',
        name: 'ai-ide-tools',
        url: 'http://127.0.0.1:18900/mcp',
      }),
    ])
  })

  test('projects a bound Codex model connection without changing system Runtime env', () => {
    const project = projectStore.create({ name: 'Codex project', workDir: tmp })
    const provider = modelProviderStore.create({
      name: 'codex-gateway',
      displayName: 'Codex gateway',
      protocol: 'openai',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-snapshot-secret',
    })
    const profile = modelProfileStore.create({
      name: 'Codex model',
      runtime: 'codex',
      providerId: provider.id,
      config: { model: 'gpt-5.6-sol' },
    })
    const agent = agentStore.create({
      name: 'Codex agent',
      type: 'developer',
      runtime: 'codex',
      projectId: project.id,
      config: { modelProfileId: profile.id },
    })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })

    const snapshot = buildRuntimeStateSnapshot({ sessionId: session.id })

    expect(snapshot.runtime.appliedModelProfile).toMatchObject({ modelId: 'gpt-5.6-sol' })
    expect(snapshot.runtime.gatewayAuth).toMatchObject({
      methodId: 'gateway',
      headers: { Authorization: 'Bearer sk-snapshot-secret' },
    })
    expect(snapshot.runtime.gatewayAuth?.fingerprint).not.toContain('sk-snapshot-secret')
    expect(() => structuredClone(snapshot)).not.toThrow()
  })
})
