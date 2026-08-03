import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { RuntimePort } from '../../src/ports/runtime-port.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionManager } from '../../src/core/sessions.js'
import { setRuntimePort } from '../../src/runtime/runtime-port-provider.js'
import {
  configureSessionHandler,
  getSessionCapabilitiesHandler,
} from '../../src/tools/handlers/core/session-tools.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { SessionCapabilities } from '../../src/types/ws-protocol.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-core-session-runtime-tools-'))
let caseIndex = 0
let restoreRuntimePort: (() => void) | undefined

beforeEach(() => {
  closeDatabase()
  const caseDir = resolve(root, `case-${++caseIndex}`)
  mkdirSync(caseDir, { recursive: true })
  initDatabase(resolve(caseDir, 'test.sqlite'))
})

afterEach(() => {
  restoreRuntimePort?.()
  restoreRuntimePort = undefined
  vi.restoreAllMocks()
})

afterAll(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('core Session Runtime tools', () => {
  test('registers both Agent-callable Session Runtime handlers', () => {
    expect(getHandler('core.session.capabilities')).toBe(getSessionCapabilitiesHandler)
    expect(getHandler('core.session.configure')).toBe(configureSessionHandler)
  })

  test('capabilities creates the real ACP Session without sending a prompt', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)

    const result = parseResult(await getSessionCapabilitiesHandler.execute(
      { sessionId: fixture.session.id },
      { projectId: fixture.project.id },
    ))

    expect(runtime.port.ensureSession).toHaveBeenCalledOnce()
    expect(runtime.port.prompt).not.toHaveBeenCalled()
    expect(sessionStore.get(fixture.session.id)?.acp_session_id).toBe(`acp-${fixture.session.id}`)
    expect(result).toMatchObject({
      sessionId: fixture.session.id,
      runtimeReady: true,
      currentModelId: 'model-a',
      models: [
        { modelId: 'model-a', name: 'Model A' },
        { modelId: 'model-b', name: 'Model B' },
      ],
    })
  })

  test('configure persists only values confirmed by the Runtime', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)

    const result = parseResult(await configureSessionHandler.execute({
      sessionId: fixture.session.id,
      modelId: 'model-b',
      modeId: 'plan',
      config: { effort: 'max', notifications: true },
    }, { projectId: fixture.project.id }))

    expect(runtime.port.setModel).toHaveBeenCalledWith(fixture.agent.id, fixture.session.id, 'model-b')
    expect(runtime.port.setMode).toHaveBeenCalledWith(fixture.agent.id, fixture.session.id, 'plan')
    expect(runtime.port.setConfig).toHaveBeenCalledWith(fixture.agent.id, fixture.session.id, 'effort', 'max')
    expect(runtime.port.setConfig).toHaveBeenCalledWith(fixture.agent.id, fixture.session.id, 'notifications', true)
    expect(sessionStore.getRuntimePreferences(fixture.session.id)).toEqual({
      modelId: 'model-b',
      modeId: 'plan',
      config: { effort: 'max', notifications: true },
    })
    expect(result).toMatchObject({
      requested: {
        modelId: 'model-b',
        modeId: 'plan',
        config: { effort: 'max', notifications: true },
      },
      applied: {
        modelId: 'model-b',
        modeId: 'plan',
        config: { effort: 'max', notifications: true },
      },
    })
  })

  test('does not persist a model when the Runtime rejects it', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness({ rejectModel: true })
    restoreRuntimePort = setRuntimePort(runtime.port)

    await expect(configureSessionHandler.execute({
      sessionId: fixture.session.id,
      modelId: 'model-b',
    }, { projectId: fixture.project.id })).rejects.toThrow('Runtime model switch failed')

    expect(sessionStore.getRuntimePreferences(fixture.session.id)).toEqual({})
  })

  test('does not persist a model when the Runtime acknowledgement does not match', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness({ ignoreModel: true })
    restoreRuntimePort = setRuntimePort(runtime.port)

    await expect(configureSessionHandler.execute({
      sessionId: fixture.session.id,
      modelId: 'model-b',
    }, { projectId: fixture.project.id })).rejects.toThrow('模型配置未生效')

    expect(runtime.port.setModel).toHaveBeenCalledOnce()
    expect(sessionStore.getRuntimePreferences(fixture.session.id)).toEqual({})
  })

  test('rejects an empty configuration before starting the Runtime', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)

    await expect(configureSessionHandler.execute(
      { sessionId: fixture.session.id },
      { projectId: fixture.project.id },
    )).rejects.toThrow('至少需要提供 modelId、modeId 或 config')

    expect(runtime.port.ensureSession).not.toHaveBeenCalled()
  })

  test('rejects unavailable values before mutating the Runtime', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)

    await expect(configureSessionHandler.execute({
      sessionId: fixture.session.id,
      modelId: 'missing-model',
    }, { projectId: fixture.project.id })).rejects.toThrow('模型不可用')

    expect(runtime.port.setModel).not.toHaveBeenCalled()
    expect(sessionStore.getRuntimePreferences(fixture.session.id)).toEqual({})
  })

  test('rejects Sessions outside the caller project', async () => {
    const fixture = createFixture()
    const otherProject = projectStore.create({ name: 'Other', workDir: root })
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)

    await expect(getSessionCapabilitiesHandler.execute(
      { sessionId: fixture.session.id },
      { projectId: otherProject.id },
    )).rejects.toThrow('Session 不属于当前项目')

    expect(runtime.port.ensureSession).not.toHaveBeenCalled()
  })

  test('rejects a closed Session before starting the Runtime', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)
    sessionStore.updateStatus(fixture.session.id, 'closed')

    await expect(getSessionCapabilitiesHandler.execute(
      { sessionId: fixture.session.id },
      { projectId: fixture.project.id },
    )).rejects.toThrow('只能配置活动的普通 Session')

    expect(runtime.port.ensureSession).not.toHaveBeenCalled()
  })

  test('rejects non-empty and busy Sessions', async () => {
    const fixture = createFixture()
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)
    messageStore.append(fixture.session.id, { role: 'human', content: 'already used' })

    await expect(configureSessionHandler.execute({
      sessionId: fixture.session.id,
      modelId: 'model-b',
    }, { projectId: fixture.project.id })).rejects.toThrow('只能配置尚未发送消息的新会话')

    const fresh = sessionStore.create({ agentId: fixture.agent.id, projectId: fixture.project.id })
    vi.spyOn(sessionManager, 'isPromptPending').mockReturnValue(true)
    await expect(configureSessionHandler.execute({
      sessionId: fresh.id,
      modelId: 'model-b',
    }, { projectId: fixture.project.id })).rejects.toThrow('会话正在处理或等待 Prompt')
  })

  test('keeps model selection isolated between Sessions of the same Agent', async () => {
    const fixture = createFixture()
    const second = sessionStore.create({ agentId: fixture.agent.id, projectId: fixture.project.id })
    const runtime = createRuntimeHarness()
    restoreRuntimePort = setRuntimePort(runtime.port)

    await configureSessionHandler.execute(
      { sessionId: fixture.session.id, modelId: 'model-a' },
      { projectId: fixture.project.id },
    )
    await configureSessionHandler.execute(
      { sessionId: second.id, modelId: 'model-b' },
      { projectId: fixture.project.id },
    )

    const firstCaps = parseResult(await getSessionCapabilitiesHandler.execute(
      { sessionId: fixture.session.id },
      { projectId: fixture.project.id },
    ))
    const secondCaps = parseResult(await getSessionCapabilitiesHandler.execute(
      { sessionId: second.id },
      { projectId: fixture.project.id },
    ))
    expect(firstCaps.currentModelId).toBe('model-a')
    expect(secondCaps.currentModelId).toBe('model-b')
  })
})

function createFixture(): {
  project: ReturnType<typeof projectStore.create>
  agent: ReturnType<typeof agentStore.create>
  session: ReturnType<typeof sessionStore.create>
} {
  const project = projectStore.create({ name: 'Project', workDir: root })
  const agent = agentStore.create({ name: 'Coder', type: 'developer', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  return { project, agent, session }
}

function createRuntimeHarness(options: { rejectModel?: boolean; ignoreModel?: boolean } = {}): {
  port: RuntimePort
} {
  const capabilities = new Map<string, SessionCapabilities>()
  const ensureCapabilities = (sessionId: string): SessionCapabilities => {
    const existing = capabilities.get(sessionId)
    if (existing) return existing
    const created: SessionCapabilities = {
      models: [
        { modelId: 'model-a', name: 'Model A' },
        { modelId: 'model-b', name: 'Model B' },
      ],
      currentModelId: 'model-a',
      modes: [
        { modeId: 'default', name: 'Default' },
        { modeId: 'plan', name: 'Plan' },
      ],
      currentModeId: 'default',
      configOptions: [
        {
          id: 'effort',
          name: 'Effort',
          type: 'select',
          currentValue: 'high',
          options: [
            { value: 'high', name: 'High' },
            { value: 'max', name: 'Max' },
          ],
        },
        { id: 'notifications', name: 'Notifications', type: 'boolean', currentValue: false },
      ],
      commands: [],
      supportsImages: false,
      supportsAudio: false,
    }
    capabilities.set(sessionId, created)
    return created
  }

  const port: RuntimePort = {
    ensureSession: vi.fn(async (snapshot) => {
      ensureCapabilities(snapshot.session.id)
      return `acp-${snapshot.session.id}`
    }),
    prompt: vi.fn(async () => undefined),
    cancelPrompt: vi.fn(async () => ({ status: 'not-active' as const })),
    closeSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => 'acp-fork'),
    setModel: vi.fn(async (_agentId, sessionId, modelId) => {
      if (options.rejectModel) throw new Error('Runtime model switch failed')
      if (options.ignoreModel) return
      ensureCapabilities(sessionId).currentModelId = modelId
    }),
    setMode: vi.fn(async (_agentId, sessionId, modeId) => {
      ensureCapabilities(sessionId).currentModeId = modeId
    }),
    setConfig: vi.fn(async (_agentId, sessionId, configId, value) => {
      const option = ensureCapabilities(sessionId).configOptions?.find((item) => item.id === configId)
      if (option) option.currentValue = value
    }),
    getSessionCapabilities: vi.fn(async (_agentId, sessionId) => structuredClone(ensureCapabilities(sessionId))),
    resolvePermission: vi.fn(async () => false),
    resolveElicitation: vi.fn(async () => false),
    drain: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return { port }
}

function parseResult(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}
