import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase, closeDatabase } from '../../store/db.js'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import { modelProviderStore } from '../../store/model-providers.js'
import { modelProfileStore } from '../../store/model-profiles.js'
import { buildAgentRuntimeEnv } from '../../acp/model-profile-env.js'
import { retainCaptureRoute } from '../route-bindings.js'
import { setCaptureSettings } from '../capture-config.js'
import { startModelCaptureProxy, type ModelCaptureProxy } from '../proxy-server.js'
import { waitCaptureFlush } from '../capture-store.js'

let tmp: string
let upstream: Server
let upstreamPort = 0
let proxy: ModelCaptureProxy
let deadPort = 0
const routes = new Map<string, string>()
const releases: Array<() => void> = []

const ACP_UUID = '11111111-2222-3333-4444-555555555555'

interface UpstreamRecord {
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}
const upstreamRequests: UpstreamRecord[] = []

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-proxy-'))
  initDatabase(join(tmp, 'test.sqlite'))
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      upstreamRequests.push({
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const mode = (req.headers['x-test-mode'] as string | undefined) ?? 'sse'
      if (req.url?.includes('/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: 42 }))
        return
      }
      if (mode === 'boom') {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('upstream boom')
        return
      }
      if (mode === 'stall') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"first"}}\n\n')
        return // 断流:不再发送任何数据,也不 end
      }
      if (mode === 'no-headers') {
        req.resume()
        return // 连接成功但迟迟不发响应头(头阶段悬挂)
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const texts = ['Hello', 'World', 'Done']
      let index = 0
      const timer = setInterval(() => {
        if (index >= texts.length) {
          clearInterval(timer)
          res.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":3}}\n\n')
          res.end()
          return
        }
        res.write(`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${texts[index]}"}}\n\n`)
        index += 1
      }, 40)
      res.on('close', () => clearInterval(timer))
    })
  })
  await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', () => resolve()) })
  upstreamPort = (upstream.address() as { port: number }).port

  const dead = http.createServer()
  await new Promise<void>((resolve) => { dead.listen(0, '127.0.0.1', () => resolve()) })
  deadPort = (dead.address() as { port: number }).port
  dead.close()

  proxy = await startModelCaptureProxy({ port: 0, dataDir: tmp, idleTimeoutMs: 500 })
  setCaptureSettings({ enabled: true, retentionDays: 7 })
})

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  routes.clear()
  await proxy.close()
  upstream.close()
  upstream.closeAllConnections?.()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
  upstreamRequests.length = 0
})

function setupAgent(runtime: 'claude' | 'codex', baseUrl: string): string {
  const provider = modelProviderStore.create({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    displayName: '测试供应商',
    protocol: runtime === 'claude' ? 'claude' : 'openai',
    baseUrl,
    apiKey: 'sk-real-provider-key',
  })
  const config = runtime === 'claude' ? { defaultModel: 'test-model' } : { model: 'test-model' }
  const profile = modelProfileStore.create({
    name: `prof-${Math.random().toString(36).slice(2, 8)}`,
    runtime,
    providerId: provider.id,
    config,
  })
  const agent = agentStore.create({
    name: `agent-${Math.random().toString(36).slice(2, 8)}`,
    type: 'dev',
    runtime,
    config: { modelProfileMode: 'fixed', modelProfileId: profile.id },
  })
  sessionStore.create({ agentId: agent.id, acpSessionId: ACP_UUID })
  registerRoute(agent.id)
  return agent.id
}

function registerRoute(agentId: string, modelProfileIdOverride?: string): void {
  const agent = agentStore.get(agentId)!
  const binding = buildAgentRuntimeEnv(agent.runtime, agent, {}, { modelProfileIdOverride }).captureBinding!
  releases.push(retainCaptureRoute(binding))
  routes.set(agentId, new URL(binding.proxyBaseUrl).pathname)
}

function claudeBody(): string {
  return JSON.stringify({
    model: 'test-model',
    stream: true, // 流式正式请求 → kind 'messages'(计数);缺 stream 会归为 probe 探测
    metadata: { user_id: `user_abc_account__session_${ACP_UUID}` },
    messages: [{ role: 'user', content: 'hi' }],
  })
}

function postThroughProxy(agentId: string, path: string, body: string, headers: Record<string, string> = {}): Promise<{
  status: number
  body: string
  chunkTimes: number[]
}> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxy.port,
      path: `${routes.get(agentId) ?? `/agent-${agentId}`}${path}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-client-key', ...headers },
    }, (res) => {
      const chunkTimes: number[] = []
      const parts: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunkTimes.push(Date.now()); parts.push(chunk) })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8'), chunkTimes }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function findCaptureFiles(sessionDirName?: string): string[] {
  const root = join(tmp, 'captures')
  if (!existsSync(root)) return []
  const results: string[] = []
  for (const day of readdirSync(root)) {
    const dayPath = join(root, day)
    for (const session of readdirSync(dayPath)) {
      if (sessionDirName && session !== sessionDirName) continue
      const sessionPath = join(dayPath, session)
      for (const file of readdirSync(sessionPath)) {
        if (file.endsWith('.json')) results.push(join(sessionPath, file))
      }
    }
  }
  return results
}

function sessionDirOf(platformSessionId: string): string {
  return `sess-${platformSessionId.replace(/^sess-/, '')}`
}

/** 轮询等待条件成立(客户端断开事件传播到 proxy 需要几拍)。 */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('模型代理抓包 proxy-server', () => {
  test('前缀解析与剥离:剩余路径+query 原样转发到 provider', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const res = await postThroughProxy(agentId, '/v1/messages?beta=true', claudeBody())
    expect(res.status).toBe(200)
    expect(upstreamRequests).toHaveLength(1)
    expect(upstreamRequests[0].url).toBe('/v1/messages?beta=true')
    expect(JSON.parse(upstreamRequests[0].body).metadata.user_id).toContain('11111111')
  })

  test('鉴权头重写:换 provider 真 key,剥离下游伪造鉴权', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    await postThroughProxy(agentId, '/v1/messages', claudeBody(), { authorization: 'Bearer client-forged' })
    expect(upstreamRequests[0].headers['x-api-key']).toBe('sk-real-provider-key')
    expect(upstreamRequests[0].headers.authorization).toBeUndefined()
  })

  test('SSE 逐 chunk 透传:下游接收时序早于落盘完成,text/usage 重组', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const res = await postThroughProxy(agentId, '/v1/messages', claudeBody())
    const receivedSpan = res.chunkTimes[res.chunkTimes.length - 1] - res.chunkTimes[0]
    expect(receivedSpan).toBeGreaterThanOrEqual(30) // 分块到达,证明未整段缓冲
    expect(res.body).toContain('Hello')

    await waitCaptureFlush()
    const files = findCaptureFiles(sessionDirOf(platformSessionId))
    expect(files).toHaveLength(1)
    const record = JSON.parse(readFileSync(files[0], 'utf8'))
    expect(record.terminalStatus).toBe('completed')
    expect(record.response.sse).toHaveLength(4)
    expect(record.response.text).toBe('HelloWorldDone')
    expect(record.response.usage).toMatchObject({ input_tokens: 10, output_tokens: 3 })
    expect(record.platform.sessionId).toBe(platformSessionId)
    expect(record.requestHeaders['x-api-key']).not.toBe('sk-real-provider-key') // 打码
    expect(record.request.metadata.user_id).toContain('11111111')
  })

  test('client_aborted:下游断开后已收内容完整落盘', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const received: string[] = []
    const req = http.request({
      host: '127.0.0.1', port: proxy.port, method: 'POST',
      path: `${routes.get(agentId)}/v1/messages`,
      headers: { 'content-type': 'application/json' },
    })
    const done = new Promise<void>((resolve) => {
      req.on('response', (res) => {
        res.on('data', (chunk: Buffer) => {
          received.push(chunk.toString('utf8'))
          if (received.length >= 1) { req.destroy(); resolve() }
        })
      })
      req.on('error', () => resolve())
      req.on('close', () => resolve())
    })
    req.end(claudeBody())
    await done
    await waitCaptureFlush()
    // 客户端 destroy 事件异步传播到 proxy 才触发 client_aborted 终态落盘,轮询等待
    const files = await waitFor(() => {
      const found = findCaptureFiles(sessionDirOf(platformSessionId))
      return found.length > 0 ? found : undefined
    })
    expect(files).toHaveLength(1)
    const record = JSON.parse(readFileSync(files[0], 'utf8'))
    expect(record.terminalStatus).toBe('client_aborted')
    expect(record.response.sse.length).toBeGreaterThanOrEqual(1)
  })

  test('upstream_error:上游 5xx 字节级透传,终态 upstream_error', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const res = await postThroughProxy(agentId, '/v1/messages', claudeBody(), { 'x-test-mode': 'boom' })
    expect(res.status).toBe(500)
    expect(res.body).toBe('upstream boom')
    await waitCaptureFlush()
    const record = JSON.parse(readFileSync(findCaptureFiles(sessionDirOf(platformSessionId))[0], 'utf8'))
    expect(record.terminalStatus).toBe('upstream_error')
    expect(record.status).toBe(500)
  })

  test('upstream_error:上游连接拒绝时返回 502 并落盘', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${deadPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const res = await postThroughProxy(agentId, '/v1/messages', claudeBody())
    expect(res.status).toBe(502)
    expect(JSON.parse(res.body).error).toContain('upstream connection failed')
    await waitCaptureFlush()
    const record = JSON.parse(readFileSync(findCaptureFiles(sessionDirOf(platformSessionId))[0], 'utf8'))
    expect(record.terminalStatus).toBe('upstream_error')
  })

  test('团队成员继承档案:通过启动时的绑定转发，不依赖旧 Host 内存', async () => {
    // 模拟团队成员:provider/profile 在库里,但 agent 自身不配档案(注入侧靠 override 继承)
    const provider = modelProviderStore.create({
      name: `p-${Math.random().toString(36).slice(2, 8)}`,
      displayName: '继承供应商',
      protocol: 'claude',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-real-provider-key',
    })
    const profile = modelProfileStore.create({
      name: `prof-${Math.random().toString(36).slice(2, 8)}`,
      runtime: 'claude',
      providerId: provider.id,
      config: { defaultModel: 'test-model' },
    })
    const agent = agentStore.create({
      name: `member-${Math.random().toString(36).slice(2, 8)}`,
      type: 'dev',
      runtime: 'claude',
      config: {}, // 无 modelProfileId,与故障中的体检员一致
    })
    // 旧 URL 不再重新猜测档案，明确要求刷新连接。
    const before = await postThroughProxy(agent.id, '/v1/messages', claudeBody())
    expect(before.status).toBe(410)
    registerRoute(agent.id, profile.id)
    // 已启动的 Runtime 即使数据库配置后来变化，仍使用原连接。
    modelProviderStore.update(provider.id, { baseUrl: `http://127.0.0.1:${deadPort}`, apiKey: 'changed-key' })
    const res = await postThroughProxy(agent.id, '/v1/messages', claudeBody())
    expect(res.status).toBe(200)
    expect(res.body).toContain('Hello')
    expect(upstreamRequests[0].headers['x-api-key']).toBe('sk-real-provider-key')
  })

  test('timeout:上游断流超时后终态 timeout,保留已收内容', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const res = await postThroughProxy(agentId, '/v1/messages', claudeBody(), { 'x-test-mode': 'stall' })
    expect(res.body).toContain('first')
    await waitCaptureFlush()
    const record = JSON.parse(readFileSync(findCaptureFiles(sessionDirOf(platformSessionId))[0], 'utf8'))
    expect(record.terminalStatus).toBe('timeout')
    expect(record.response.sse).toHaveLength(1)
    expect(record.error).toContain('idle timeout')
  }, 10_000)

  test('头阶段 idle 超时:上游连接成功但不发响应头 → 下游 504 + capture 落 timeout', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const res = await postThroughProxy(agentId, '/v1/messages', claudeBody(), { 'x-test-mode': 'no-headers' })
    expect(res.status).toBe(504)
    expect(res.body).toContain('idle timeout')
    await waitCaptureFlush()
    const record = JSON.parse(readFileSync(findCaptureFiles(sessionDirOf(platformSessionId))[0], 'utf8'))
    expect(record.terminalStatus).toBe('timeout')
    expect(record.error).toContain('idle timeout')
  }, 10_000)

  test('count_tokens JSON 分支:照常透传并落盘', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const res = await postThroughProxy(agentId, '/v1/messages/count_tokens', claudeBody())
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).input_tokens).toBe(42)
    await waitCaptureFlush()
    const record = JSON.parse(readFileSync(findCaptureFiles(sessionDirOf(platformSessionId))[0], 'utf8'))
    expect(record.kind).toBe('count_tokens')
    expect(record.terminalStatus).toBe('completed')
    expect(record.response.sse).toHaveLength(0)
  })

  test('30 路并发流全部完成且落盘终态正确', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const results = await Promise.all(
      Array.from({ length: 30 }, () => postThroughProxy(agentId, '/v1/messages', claudeBody())),
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
    await waitCaptureFlush()
    const files = findCaptureFiles(sessionDirOf(platformSessionId))
    expect(files).toHaveLength(30)
    const statuses = files.map((f) => JSON.parse(readFileSync(f, 'utf8')).terminalStatus as string)
    expect(statuses.every((s) => s === 'completed')).toBe(true)
  }, 20_000)

  test('无法归因的请求落 _unattributed', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    await postThroughProxy(agentId, '/v1/messages', JSON.stringify({ model: 'test-model', messages: [] }))
    await waitCaptureFlush()
    const files = findCaptureFiles('_unattributed')
    expect(files).toHaveLength(1)
  })

  test('总开关关闭:照常转发,零落盘', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    setCaptureSettings({ enabled: false })
    const res = await postThroughProxy(agentId, '/v1/messages/count_tokens', claudeBody())
    expect(res.status).toBe(200)
    await waitCaptureFlush()
    expect(findCaptureFiles()).toHaveLength(0)
  })

  test('maxPerSession 来自 settings:只数 messages/responses,count_tokens 不占额度', async () => {
    const agentId = setupAgent('claude', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    setCaptureSettings({ enabled: true, retentionDays: 7, maxPerSession: 1 })
    await postThroughProxy(agentId, '/v1/messages/count_tokens', claudeBody())
    await postThroughProxy(agentId, '/v1/messages', claudeBody())
    await postThroughProxy(agentId, '/v1/messages', claudeBody())
    await waitCaptureFlush()
    // count_tokens 照常落盘不占额度;messages 超限只留最新 1 个
    const files = await waitFor(() => {
      const found = findCaptureFiles(sessionDirOf(platformSessionId))
      const messages = found.filter((f) => f.endsWith('-messages.json'))
      const countTokens = found.filter((f) => f.endsWith('-count_tokens.json'))
      return messages.length === 1 && countTokens.length === 1 ? found : undefined
    })
    expect(files.filter((f) => f.endsWith('-messages.json'))).toHaveLength(1)
    expect(files.filter((f) => f.endsWith('-count_tokens.json'))).toHaveLength(1)
  }, 15_000)

  test('codex responses 路径:前缀剥离+Bearer 鉴权重写+turn_id 归档', async () => {
    const agentId = setupAgent('codex', `http://127.0.0.1:${upstreamPort}`)
    const platformSessionId = sessionStore.list(agentId)[0].id
    const body = JSON.stringify({
      model: 'test-model',
      stream: true,
      client_metadata: {
        session_id: ACP_UUID,
        thread_id: ACP_UUID,
        turn_id: 'turn-777',
      },
    })
    const res = await postThroughProxy(agentId, '/responses', body)
    expect(res.status).toBe(200)
    // codex provider baseUrl 无 /v1 时,normalizeOpenAiBaseUrl 补 /v1 后再拼 /responses(与直连口径一致)
    expect(upstreamRequests[0].url).toBe('/v1/responses')
    expect(upstreamRequests[0].headers.authorization).toBe('Bearer sk-real-provider-key')
    await waitCaptureFlush()
    const record = JSON.parse(readFileSync(findCaptureFiles(sessionDirOf(platformSessionId))[0], 'utf8'))
    expect(record.kind).toBe('responses')
    expect(record.platform.turnId).toBe('turn-777')
  })
})
