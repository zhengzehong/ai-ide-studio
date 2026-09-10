import { afterEach, beforeEach, expect, test } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { setCaptureSettings } from '../../src/model-capture/capture-config.js'
import { startModelCaptureProxy, type ModelCaptureProxy } from '../../src/model-capture/proxy-server.js'
import { acquireCaptureRoute } from '../../src/model-capture/route-bindings.js'
import { buildAgentRuntimeEnv } from '../../src/acp/model-profile-env.js'
import { createProcessRuntimePort, type ProcessRuntimePort } from '../../src/runtime/api/process-runtime-port.js'
import { createRealtimeProcess, type RealtimeProcessHandle } from '../../src/realtime/process-client.js'
import type { RuntimeStateSnapshot } from '../../src/ports/runtime-port.js'

let tmp: string
let proxy: ModelCaptureProxy
let runtime: ProcessRuntimePort | undefined
let realtime: RealtimeProcessHandle | undefined
let upstream: http.Server
let upstreamUrl: string
const requests: Array<{ path: string; key: string | string[] | undefined; model: string }> = []

beforeEach(async () => {
  tmp = mkdtempSync(resolve(tmpdir(), 'model-proxy-runtime-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({ path: req.url!, key: req.headers['x-api-key'] ?? req.headers.authorization,
        model: (JSON.parse(Buffer.concat(chunks).toString()) as { model: string }).model })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  proxy = await startModelCaptureProxy({ port: 0, dataDir: tmp })
  setCaptureSettings({ enabled: true })
})

afterEach(async () => {
  await runtime?.close()
  runtime = undefined
  await realtime?.close()
  realtime = undefined
  await proxy.close()
  upstream.closeAllConnections()
  await new Promise<void>((done) => upstream.close(() => done()))
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
  requests.length = 0
})

test.each(['claude', 'codex'] as const)('%s independent Runtime retains inherited connection until replacement or exit', async (kind) => {
  const provider = modelProviderStore.create({
    name: 'provider', displayName: 'Provider', protocol: kind === 'claude' ? 'claude' : 'openai',
    baseUrl: `${upstreamUrl}/old`, apiKey: 'old-key',
  })
  const profile = modelProfileStore.create({ name: 'profile', runtime: kind, providerId: provider.id,
    config: kind === 'claude' ? { defaultModel: 'test-model' } : { model: 'test-model' } })
  const agent = agentStore.create({ name: 'member', type: 'developer', runtime: kind, config: {} })
  const makeSnapshot = (): RuntimeStateSnapshot => {
    const prepared = buildAgentRuntimeEnv(kind, agent, process.env, { modelProfileIdOverride: profile.id })
    return {
      agent: { id: agent.id, name: agent.name, type: agent.type, runtime: kind, permissionLevel: 3,
        config: {}, systemPrompt: '', projectId: null },
      session: { id: 'session-a', agentId: agent.id, taskId: null, projectId: null, cwd: tmp,
        title: 'test', acpSessionId: null, isPrimary: false, purpose: 'conversation' },
      runtime: {
        command: { cmd: process.execPath, args: [resolve('tests/fixtures/capture-acp-agent.mjs')] },
        env: { ...Object.fromEntries(Object.entries(prepared.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
          CAPTURE_TEST_RUNTIME: kind },
        gatewayAuth: prepared.gatewayAuth, captureBinding: prepared.captureBinding,
        appliedModelProfile: prepared.appliedProfile,
      },
      runtimePreferences: {}, mcpServers: [], autoApprovedToolNames: [],
    }
  }
  realtime = await createRealtimeProcess({ host: '127.0.0.1', port: 0,
    authenticate: async () => ({ authMode: 'owner' }), dispatchLegacyRpc: async ({ state }) => state.subscriptions })
  const statuses: string[] = []
  runtime = await createProcessRuntimePort({
    realtimeStreamEndpoint: realtime.runtimeStreamEndpoint, realtimeStreamToken: realtime.runtimeStreamToken,
    onPersistenceUpdate: async () => undefined, onDone: async () => undefined,
    onAgentStatus: (event) => { statuses.push(event.status) },
  })
  const first = makeSnapshot()
  const firstId = first.runtime.captureBinding!.id
  expect(acquireCaptureRoute(firstId)).toBeUndefined()
  await runtime.ensureSession(first)
  await runtime.ensureSession(makeSnapshot())
  expect(statuses.filter((status) => status === 'running')).toHaveLength(1)
  modelProviderStore.update(provider.id, { baseUrl: `${upstreamUrl}/new`, apiKey: 'new-key' })
  await runtime.setModel(agent.id, 'session-a', 'native-subagent-model')
  await runtime.prompt({ agentId: agent.id, sessionId: 'session-a', content: 'test' })
  expect(requests.at(-1)).toMatchObject({
    path: kind === 'claude' ? '/old/v1/messages' : '/old/v1/responses',
    key: kind === 'claude' ? 'old-key' : 'Bearer old-key', model: 'native-subagent-model',
  })
  const second = makeSnapshot()
  const secondId = second.runtime.captureBinding!.id
  expect(secondId).not.toBe(firstId)
  await runtime.ensureSession(second)
  await runtime.prompt({ agentId: agent.id, sessionId: 'session-a', content: 'test' })
  expect(requests.at(-1)).toMatchObject({
    path: kind === 'claude' ? '/new/v1/messages' : '/new/v1/responses',
    key: kind === 'claude' ? 'new-key' : 'Bearer new-key',
  })
  expect(acquireCaptureRoute(firstId)).toBeUndefined()
  const lease = acquireCaptureRoute(secondId)!
  expect(lease).toBeDefined()
  lease.release()
  const generation = runtime.generation
  await runtime.terminateForTest()
  expect(acquireCaptureRoute(secondId)).toBeUndefined()
  await runtime.waitForRestart(generation)
  await runtime.ensureSession(makeSnapshot())
  await runtime.prompt({ agentId: agent.id, sessionId: 'session-a', content: 'after restart' })
  await runtime.close()
  runtime = undefined
  expect(acquireCaptureRoute(secondId)).toBeUndefined()
}, 30_000)
