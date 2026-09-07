import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import { resolveVisiblePlatformTools } from '../../src/tools/registry/visibility-resolver.js'
import { createToolContext } from '../../src/tools/registry/context-registry.js'
import { beginDeviceOrigin, endDeviceOrigin } from '../../src/devices/prompt-origin.js'
import { issueDevicePairing, pairDevice } from '../../src/devices/auth.js'
import { executeDeviceTool } from '../../src/devices/tool-provider.js'
import { startGateway } from '../../src/gateway/server.js'
import { startEdgeGateway, type EdgeGatewayHandle } from '../../src/edge/gateway.js'
import { NodeConnector } from '../../electron/node/connector.js'
import { detectNodeShells } from '../../electron/node/shells.js'
import type { ToolContext } from '../../src/tools/types.js'

let directory: string
let server: Server
let origin: string
let edge: EdgeGatewayHandle
let context: ToolContext & { sessionId: string; agentId: string; projectId: string }
const nodes: NodeConnector[] = []
let pairSequence = 0

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'device-execution-'))
  initDatabase(join(directory, 'test.sqlite'))
  const project = projectStore.create({ name: 'Device test', workDir: directory })
  const agent = agentStore.create({ name: 'Tester', type: 'dev', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
  context = { projectId: project.id, agentId: agent.id, sessionId: session.id, workDir: directory }
  seedBuiltinTools()
  const handle = await startGateway({ host: '127.0.0.1', port: 0, dataDir: directory, runtime: 'web', localToken: 'test-owner' }, { webSocketMode: 'none' })
  server = handle.server
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  edge = await startEdgeGateway({ host: '127.0.0.1', port: 0, targets: { apiUrl: `http://127.0.0.1:${address.port}` } })
  origin = edge.endpointUrl
  beginDeviceOrigin(context.sessionId, 'turn', [{ source: 'user', options: {} }])
})

afterEach(async () => {
  for (const node of nodes.splice(0)) await node.stop()
  endDeviceOrigin(context.sessionId, 'turn')
  await edge?.close()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

async function connectNode(name = 'Remote PC'): Promise<string> {
  const keys = generateKeyPairSync('ed25519')
  const credentials = pairDevice({ ...issueDevicePairing(), name, platform: 'win32', shells: ['powershell'],
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, `device-${++pairSequence}`)
  const node = new NodeConnector(origin, { ...credentials, privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), enabled: true },
    join(directory, 'node', credentials.deviceId), detectNodeShells())
  nodes.push(node)
  node.start()
  await until(() => node.online())
  return credentials.deviceId
}

async function invoke(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return await executeDeviceTool('invoke_device_command', input, context) as Record<string, unknown>
}

async function completion(deviceId: string, jobId: unknown): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = {}
  await until(async () => {
    result = await invoke({ deviceId, jobId, type: 'job.status' })
    return ['succeeded', 'failed', 'timed_out', 'cancelled', 'unknown'].includes(String(result.state))
  }, 12_000)
  return result
}

async function until(test: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!await test()) {
    if (Date.now() > deadline) throw new Error('Test wait timed out')
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

describe('remote devices end to end', () => {
  it('registers both AI tools, enforces scoped HTTP access, and connects in separate realtime mode', async () => {
    const id = await connectNode()
    const names = resolveVisiblePlatformTools(context).map((tool) => tool.definition.name)
    expect(names).toContain('device_list')
    expect(names).toContain('invoke_device_command')
    expect(getHandler('device_list')).toBeDefined()
    expect((await fetch(`${origin}/api/v1/devices`)).status).toBe(401)
    expect((await fetch(`${origin}/device-tools`, { method: 'POST', body: '{}' })).status).toBe(401)
    const { token } = createToolContext({ ...context, visibleTools: ['device_list'] })
    const response = await fetch(`${origin}/device-tools`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ action: 'device_list', input: {} }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ defaultExecution: 'server', devices: [{ deviceId: id, online: true, isCurrentDevice: false }] })
    beginDeviceOrigin(context.sessionId, 'turn', [{ source: 'user', options: { originDeviceId: id } }])
    expect(await executeDeviceTool('device_list', {}, context)).toMatchObject({ devices: [{ isCurrentDevice: true }] })
    beginDeviceOrigin(context.sessionId, 'turn', [{ source: 'platform', options: { senderRole: 'guest' } }])
    await expect(executeDeviceTool('device_list', {}, context)).rejects.toThrow('非访客')
  })

  it.runIf(process.platform === 'win32')('runs PowerShell with output/cwd, checks ownership, and cancels a running job', async () => {
    const deviceId = await connectNode()
    const result = await invoke({ deviceId, type: 'shell', command: "Write-Output '中文执行结果'", cwd: directory })
    const finished = result.state === 'succeeded' ? result : await completion(deviceId, result.jobId)
    expect(finished).toMatchObject({ state: 'succeeded', exitCode: 0, deviceId, cwd: directory })
    expect(finished.output).toContain('中文执行结果')
    await expect(invoke({ type: 'shell', command: 'echo wrong' })).rejects.toThrow('deviceId')
    await expect(invoke({ deviceId: 'another', type: 'job.status', jobId: result.jobId })).rejects.toThrow('不属于')
    const running = await invoke({ deviceId, type: 'shell', command: 'Start-Sleep -Seconds 30', background: true })
    expect(running.state).toBe('running')
    expect(await invoke({ deviceId, type: 'job.cancel', jobId: running.jobId })).toMatchObject({ state: 'cancel_requested' })
    expect(await completion(deviceId, running.jobId)).toMatchObject({ state: 'cancelled' })
    await nodes[0].stop()
    await until(async () => {
      const list = await executeDeviceTool('device_list', {}, context) as { devices: { online: boolean }[] }
      return !list.devices[0].online
    })
    await expect(invoke({ deviceId, type: 'shell', command: 'echo no-fallback' })).rejects.toThrow('离线')
  })

  it.runIf(process.platform === 'win32')('uploads and downloads byte-for-byte and never overwrites by default', async () => {
    const deviceId = await connectNode()
    const local = join(directory, 'input.bin')
    const bytes = Buffer.from('This is the client file.\n中文\0')
    writeFileSync(local, bytes)
    const upload = await invoke({ deviceId, type: 'file.upload', localPath: local })
    const uploaded = await completion(deviceId, upload.jobId)
    expect(uploaded).toMatchObject({ state: 'succeeded', size: bytes.length })
    expect(readFileSync(String(uploaded.serverPath))).toEqual(bytes)
    const destination = join(directory, 'download.bin')
    const download = await invoke({ deviceId, type: 'file.download', fileId: uploaded.fileId, localPath: destination })
    expect(await completion(deviceId, download.jobId)).toMatchObject({ state: 'succeeded' })
    expect(readFileSync(destination)).toEqual(bytes)
    // Terminal transfer slots must be released before preparing the next job.
    const overwrite = await invoke({ deviceId, type: 'file.download', serverPath: local, localPath: destination })
    expect(await completion(deviceId, overwrite.jobId)).toMatchObject({ state: 'failed' })
    expect(readFileSync(destination)).toEqual(bytes)
  })
})
