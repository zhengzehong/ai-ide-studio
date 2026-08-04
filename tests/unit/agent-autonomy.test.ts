import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { RuntimePort } from '../../src/ports/runtime-port.js'
import { enableAgentAutonomy } from '../../src/core/agent-autonomy.js'
import { getAgentAutonomyConfig, updateAgentAutonomyConfig } from '../../src/core/agent-autonomy-config.js'
import { runAgentAutonomyTick } from '../../src/core/agent-autonomy-scheduler.js'
import { sessionManager } from '../../src/core/sessions.js'
import { deleteProjectAgent, updateProjectAgent } from '../../src/core/agents.js'
import { setRuntimePort } from '../../src/runtime/runtime-port-provider.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, getDbPath, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { ruleStore } from '../../src/store/rules.js'
import { sessionStore } from '../../src/store/sessions.js'
import type { SessionCapabilities } from '../../src/types/ws-protocol.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-autonomy-'))
let caseIndex = 0
let restoreRuntime: (() => void) | undefined

beforeEach(() => {
  closeDatabase()
  const caseDir = resolve(root, `case-${++caseIndex}`)
  mkdirSync(caseDir, { recursive: true })
  initDatabase(resolve(caseDir, 'test.sqlite'))
})

afterEach(() => {
  restoreRuntime?.()
  restoreRuntime = undefined
  vi.restoreAllMocks()
})

afterAll(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('Agent autonomy', () => {
  test('enables one fixed Session with strict Claude privileged mode and memory path', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Claude PM', type: 'pm', runtime: 'claude', projectId: project.id })
    const runtime = createRuntimeHarness('bypassPermissions')
    restoreRuntime = setRuntimePort(runtime)

    const state = await enableAgentAutonomy(agent.id)

    expect(state.config.enabled).toBe(true)
    expect(state.session).toMatchObject({ purpose: 'autonomy', agent_id: agent.id, project_id: project.id })
    expect(sessionStore.findAutonomyByAgent(agent.id)?.id).toBe(state.session?.id)
    expect(dirname(state.memory.path)).toBe(resolve(dirname(getDbPath()), 'autonomy', project.id, agent.id))
    expect(existsSync(state.memory.path)).toBe(true)
    expect(runtime.setMode).toHaveBeenCalledWith(agent.id, state.session?.id, 'bypassPermissions')
    const snapshot = vi.mocked(runtime.ensureSession).mock.calls[0]?.[0]
    expect(snapshot?.session.purpose).toBe('autonomy')
    const systemPrompt = promptText(snapshot?.runtime.sessionMeta)
    expect(systemPrompt).toContain('自主运行模式')
    expect(systemPrompt).toContain(state.memory.path)
    expect(systemPrompt).toContain('不创建平台 Task')
    expect(ruleStore.get(state.config.heartbeatRuleId as string)).toMatchObject({
      cron: '*/10 * * * *',
      action: 'autonomy_tick',
      enabled: true,
    })

    const again = await enableAgentAutonomy(agent.id)
    expect(again.session?.id).toBe(state.session?.id)
    expect(sessionStore.list(agent.id, project.id).filter((session) => session.purpose === 'autonomy')).toHaveLength(1)
  })

  test('does not enable when Runtime fails to acknowledge privileged mode', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Codex', type: 'dev', runtime: 'codex', projectId: project.id })
    restoreRuntime = setRuntimePort(createRuntimeHarness('default', true))

    await expect(enableAgentAutonomy(agent.id)).rejects.toThrow('模式配置未生效')
    expect(getAgentAutonomyConfig(agent.id).enabled).toBe(false)
    expect(ruleStore.list(project.id)).toHaveLength(0)
  })

  test('skips a busy autonomy Session without queueing another Prompt', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id, purpose: 'autonomy' })
    updateAgentAutonomyConfig(agent.id, { enabled: true, autonomySessionId: session.id, dirty: true })
    vi.spyOn(sessionManager, 'isPromptPending').mockReturnValue(true)
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt')

    await expect(runAgentAutonomyTick(agent.id, session.id, { force: true })).resolves.toEqual({ skipped: 'busy' })
    expect(enqueue).not.toHaveBeenCalled()
    expect(getAgentAutonomyConfig(agent.id).lastSkipReason).toBe('busy')
  })

  test('requires autonomy to be stopped before a Runtime change and removes its heartbeat on delete', async () => {
    const project = projectStore.create({ name: 'Project', workDir: root })
    const agent = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
    const state = await enableAgentAutonomy(agent.id)

    expect(() => updateProjectAgent(agent.id, { runtime: 'codex' })).toThrow('先停用自主模式')
    deleteProjectAgent(agent.id)
    expect(ruleStore.get(state.config.heartbeatRuleId as string)).toBeUndefined()
  })
})

function createRuntimeHarness(initialMode: string, ignoreMode = false): RuntimePort {
  const capabilities = new Map<string, SessionCapabilities>()
  const caps = (sessionId: string): SessionCapabilities => {
    const current = capabilities.get(sessionId)
    if (current) return current
    const created: SessionCapabilities = {
      models: [],
      modes: [
        { modeId: 'default', name: 'Default' },
        { modeId: 'bypassPermissions', name: 'Bypass permissions' },
        { modeId: 'agent-full-access', name: 'Agent full access' },
      ],
      currentModeId: initialMode,
      configOptions: [],
      commands: [],
      supportsImages: false,
      supportsAudio: false,
    }
    capabilities.set(sessionId, created)
    return created
  }
  return {
    ensureSession: vi.fn(async (snapshot) => {
      caps(snapshot.session.id)
      return `acp-${snapshot.session.id}`
    }),
    prompt: vi.fn(async () => undefined),
    cancelPrompt: vi.fn(async () => ({ status: 'not-active' as const })),
    closeSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => 'acp-fork'),
    setModel: vi.fn(async () => undefined),
    setMode: vi.fn(async (_agentId, sessionId, modeId) => {
      if (!ignoreMode) caps(sessionId).currentModeId = modeId
    }),
    setConfig: vi.fn(async () => undefined),
    getSessionCapabilities: vi.fn(async (_agentId, sessionId) => structuredClone(caps(sessionId))),
    resolvePermission: vi.fn(async () => true),
    resolveElicitation: vi.fn(async () => true),
    drain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

function promptText(meta: Record<string, unknown> | undefined): string {
  const prompt = meta?.systemPrompt
  if (typeof prompt === 'string') return prompt
  if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
    const append = (prompt as Record<string, unknown>).append
    return typeof append === 'string' ? append : ''
  }
  return ''
}
