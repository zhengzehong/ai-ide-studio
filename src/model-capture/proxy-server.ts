import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { createChildLogger } from '../core/logger.js'
import { acquireCaptureRoute, activateCaptureRoutes } from './route-bindings.js'
import { getCaptureSettings } from './capture-config.js'
import {
  beginCapture,
  captureCleanupPending,
  captureRoot,
  cleanupExpiredCaptures,
  parseCaptureMaxTotalBytes,
  recoverPendingCaptures,
  waitCaptureFlush,
  type CaptureTerminalStatus,
  type CaptureWriter,
} from './capture-store.js'
import {
  detectCaptureKind,
  extractCaptureIdentity,
  lookupSessionByAcpUuid,
  maskSensitiveHeaders,
} from './classify.js'

/**
 * 模型代理抓包服务:本地纯转发中间人。
 * 红线:上游响应字节级透传(收到 chunk 立即写下游),绝不改写上游响应、绝不自造针对正常上游响应的错误。
 */
const log = createChildLogger('model-capture-proxy')

const IDLE_TIMEOUT_MS = 120_000
const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
/** 抓包清理节奏:常规每小时一次;上一轮因时间预算未删完时 30s 后提前重试。 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const CLEANUP_RETRY_MS = 30 * 1000

export interface ModelCaptureProxy {
  readonly port: number
  readonly listening: boolean
  close(): Promise<void>
}

export interface ModelCaptureProxyOptions {
  port: number
  dataDir: string
  /** 透传空闲超时(无新 chunk 视为 timeout);默认 120s,测试可调短。 */
  idleTimeoutMs?: number
}

export async function startModelCaptureProxy(options: ModelCaptureProxyOptions): Promise<ModelCaptureProxy> {
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS
  const captureRootDir = captureRoot(options.dataDir)
  let actualPort = options.port

  try {
    await recoverPendingCaptures(captureRootDir)
    await cleanupExpiredCaptures(captureRootDir, getCaptureSettings().retentionDays, {
      maxTotalBytes: parseCaptureMaxTotalBytes(process.env.CAPTURE_MAX_TOTAL_BYTES),
    })
  } catch (err) {
    log.warn({ err }, '抓包启动恢复/清理失败(不阻塞启动)')
  }

  // 分片异步清理:单轮 3s 时间预算,超出留待下一轮;上一轮有剩余时 30s 后提前重试,
  // 否则维持每小时一次。总量上限默认关闭(env CAPTURE_MAX_TOTAL_BYTES)。
  const cleanupTimerRef: { current?: ReturnType<typeof setTimeout> } = {}
  let cleanupStopped = false
  const runCleanup = (): void => {
    if (cleanupStopped) return
    void cleanupExpiredCaptures(captureRootDir, getCaptureSettings().retentionDays, {
      maxTotalBytes: parseCaptureMaxTotalBytes(process.env.CAPTURE_MAX_TOTAL_BYTES),
    })
      .then(() => {
        if (cleanupStopped) return
        scheduleCleanup(captureCleanupPending() ? CLEANUP_RETRY_MS : CLEANUP_INTERVAL_MS)
      })
      .catch((err: unknown) => {
        log.warn({ err }, '抓包过期目录清理失败')
        if (cleanupStopped) return
        scheduleCleanup(CLEANUP_INTERVAL_MS)
      })
  }
  const scheduleCleanup = (delayMs: number): void => {
    cleanupTimerRef.current = setTimeout(runCleanup, delayMs)
    cleanupTimerRef.current.unref()
  }
  scheduleCleanup(CLEANUP_INTERVAL_MS)

  const server: Server = http.createServer((req, res) => { void handleCaptureRequest(req, res, captureRootDir, idleTimeoutMs) })
  let listenFailed = false
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      listenFailed = true
      log.warn({ port: options.port }, '模型代理端口被占用,本实例不启用抓包代理(功能降级,不影响其他服务)')
      return
    }
    log.error({ err, port: actualPort }, '模型代理服务异常')
  })
  server.listen(options.port, '127.0.0.1', () => {
    const address = server.address()
    if (address && typeof address === 'object') actualPort = address.port
    log.info({ port: actualPort }, '模型代理抓包服务已启动(常驻,不随总开关启停)')
  })

  // 等待监听完成再返回,保证调用方拿到的 port 是真实端口(port 0 场景);EADDRINUSE 时经 error 分支直接返回
  await new Promise<void>((resolve) => {
    server.once('listening', resolve)
    server.once('error', () => resolve())
  })
  const deactivateRoutes = server.listening ? activateCaptureRoutes(actualPort) : (): void => {}

  return {
    get port() { return actualPort },
    get listening() { return !listenFailed && server.listening },
    async close() {
      deactivateRoutes()
      cleanupStopped = true
      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current)
      await new Promise<void>((resolve) => {
        if (!server.listening) { resolve(); return }
        server.close(() => resolve())
      })
      server.closeAllConnections?.()
      await waitCaptureFlush()
    },
  }
}

async function handleCaptureRequest(
  req: IncomingMessage,
  res: ServerResponse,
  captureRootDir: string,
  idleTimeoutMs: number,
): Promise<void> {
  let target: URL
  try {
    target = new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    respondJson(res, 404, { error: 'invalid url' })
    return
  }
  const match = /^\/route\/([a-f0-9]{64})(\/.*)$/.exec(target.pathname)
  if (!match) {
    if (target.pathname.startsWith('/agent-')) {
      log.warn('收到旧版模型代理路由，需通过正常 Runtime 重建更新连接')
      respondJson(res, 410, { error: 'obsolete model route; refresh the Agent Runtime connection' })
    } else respondJson(res, 404, { error: 'missing /route/<bindingId> prefix' })
    return
  }
  const lease = acquireCaptureRoute(match[1])
  if (!lease) {
    log.warn({ bindingId: match[1] }, '模型代理连接绑定不存在或已释放')
    respondJson(res, 410, { error: 'model route expired; refresh the Agent Runtime connection' })
    return
  }
  try {
    await handleBoundRequest(req, res, target, match[2], lease.binding, captureRootDir, idleTimeoutMs)
  } finally {
    lease.release()
  }
}

async function handleBoundRequest(
  req: IncomingMessage, res: ServerResponse, target: URL, restPath: string,
  resolved: NonNullable<ReturnType<typeof acquireCaptureRoute>>['binding'],
  captureRootDir: string, idleTimeoutMs: number,
): Promise<void> {
  const { agentId, runtime } = resolved

  let body: Buffer
  try {
    body = await readRequestBody(req)
  } catch (err) {
    log.warn({ err, agentId }, '读取请求体失败')
    respondJson(res, 400, { error: 'failed to read request body' })
    return
  }

  const upstreamUrl = buildUpstreamUrl(resolved.baseUrl, restPath, target.search)
  if (!upstreamUrl) {
    respondJson(res, 502, { error: `unsupported provider base url: ${resolved.baseUrl}` })
    return
  }

  const capture = beginCaptureIfNeeded({
    captureRootDir,
    agentId,
    runtime,
    restPath,
    body,
    providerName: resolved.providerName,
    reqHeaders: req.headers,
  })

  await forwardRequest({
    method: (req.method ?? 'GET').toUpperCase(),
    upstreamUrl,
    body,
    reqHeaders: req.headers,
    runtime,
    providerApiKey: resolved.apiKey,
    res,
    capture,
    idleTimeoutMs,
  })
}

function buildUpstreamUrl(
  providerBaseUrl: string,
  restPath: string,
  search: string,
): string | null {
  try {
    const base = new URL(providerBaseUrl)
    return `${base.origin}${base.pathname.replace(/\/$/, '')}${restPath}${search}`
  } catch {
    return null
  }
}

function beginCaptureIfNeeded(input: {
  captureRootDir: string
  agentId: string
  runtime: string
  restPath: string
  body: Buffer
  providerName: string
  reqHeaders: IncomingMessage['headers']
}): CaptureWriter | null {
  if (!getCaptureSettings().enabled) return null
  try {
    const settings = getCaptureSettings()
    const parsedBody: unknown = parseJsonBody(input.body)
    const model = parsedBody && typeof parsedBody === 'object' && 'model' in parsedBody
      && typeof parsedBody.model === 'string' ? parsedBody.model : undefined
    const identity = extractCaptureIdentity(parsedBody)
    const session = identity.sessionUuid ? lookupSessionByAcpUuid(identity.sessionUuid) : null
    return beginCapture(input.captureRootDir, {
      kind: detectCaptureKind(input.restPath, parsedBody),
      platform: {
        agentId: session?.agentId ?? input.agentId,
        runtime: input.runtime,
        ...(session ? { sessionId: session.sessionId } : {}),
        ...(session?.sessionTitle ? { sessionTitle: session.sessionTitle } : {}),
        ...(identity.turnId ? { turnId: identity.turnId } : {}),
      },
      ...(model ? { model } : {}),
      provider: input.providerName,
      requestHeaders: maskSensitiveHeaders({ ...input.reqHeaders }),
      request: parsedBody ?? input.body.toString('utf8'),
      maxPerSession: settings.maxPerSession,
    })
  } catch (err) {
    log.warn({ err, agentId: input.agentId }, '抓包初始化失败(不阻断转发)')
    return null
  }
}

async function forwardRequest(args: {
  method: string
  upstreamUrl: string
  body: Buffer
  reqHeaders: IncomingMessage['headers']
  runtime: string
  providerApiKey: string
  res: ServerResponse
  capture: CaptureWriter | null
  idleTimeoutMs: number
}): Promise<void> {
  const { method, upstreamUrl, body, reqHeaders, runtime, providerApiKey, res, capture, idleTimeoutMs } = args
  const url = new URL(upstreamUrl)
  const transport = url.protocol === 'https:' ? https : http

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (SKIP_REQUEST_HEADERS.has(lower)) continue
    headers[lower] = Array.isArray(value) ? value.join(', ') : value
  }
  headers['host'] = url.host
  headers['content-length'] = String(body.length)
  headers['accept-encoding'] = 'identity' // 落盘需可读原文,要求上游不压缩
  delete headers['x-api-key']
  delete headers['authorization']
  if (providerApiKey) {
    if (runtime === 'claude') headers['x-api-key'] = providerApiKey
    else headers['authorization'] = `Bearer ${providerApiKey}`
  }

  await new Promise<void>((resolve) => {
    let settled = false
    let finalized = false
    let idleTimer: NodeJS.Timeout | null = null
    let upstream: http.ClientRequest | null = null
    const finish = () => { if (!settled) { settled = true; resolve() } }
    const disarmIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null } }
    const armIdle = () => {
      disarmIdle()
      idleTimer = setTimeout(onIdleTimeout, idleTimeoutMs)
    }
    const finalizeOnce = (terminal: CaptureTerminalStatus, error?: string) => {
      if (finalized) return
      finalized = true
      disarmIdle()
      if (!capture) { finish(); return } // 关开关时也要结束等待,否则 promise 泄漏
      if (error !== undefined) capture.setError(error)
      capture.finalize(terminal).then(finish, finish)
    }

    // 头/体两阶段统一 idle 保护:收到响应头后重置窗口,收到 chunk 续期
    function onIdleTimeout(): void {
      finalizeOnce('timeout', 'idle timeout: no upstream response within window')
      if (!res.headersSent) {
        // 头阶段超时:未透传任何上游字节,明确报 504(与连接失败 502 同口径)
        respondJson(res, 504, { error: 'upstream idle timeout: no response headers received' })
      } else if (!res.writableEnded && !res.destroyed) {
        res.end() // 已透传部分原样保留,不补写状态行
      }
      if (upstream && !upstream.destroyed) upstream.destroy()
    }

    upstream = transport.request(url, { method, headers }, (upRes) => {
      const status = upRes.statusCode ?? 502
      const isJsonBody = String(upRes.headers['content-type'] ?? '').includes('application/json')
      capture?.setStatus(status)
      res.writeHead(status, upRes.headers)

      armIdle()

      upRes.on('data', (chunk: Buffer) => {
        armIdle()
        res.write(chunk)
        if (isJsonBody) capture?.appendTextChunk(chunk.toString('utf8'))
        else capture?.appendResponseChunk(chunk.toString('utf8'))
      })
      upRes.on('end', () => {
        disarmIdle()
        if (!res.writableEnded && !res.destroyed) res.end()
        finalizeOnce(status >= 500 ? 'upstream_error' : 'completed')
      })
      upRes.on('error', (err: Error) => {
        disarmIdle()
        finalizeOnce('upstream_error', err.message)
        if (!res.writableEnded && !res.destroyed) res.end() // 已透传部分原样保留,不补写状态行
      })
    })

    upstream.on('error', (err: Error) => {
      disarmIdle()
      finalizeOnce('upstream_error', err.message)
      if (!res.headersSent && !res.destroyed) respondJson(res, 502, { error: `upstream connection failed: ${err.message}` })
      else if (!res.writableEnded && !res.destroyed) res.end()
    })

    res.on('close', () => {
      if (res.writableEnded) return
      finalizeOnce('client_aborted', 'client disconnected before response finished')
      upstream.destroy()
    })

    upstream.end(body)
    armIdle() // 头阶段也纳入 idle 保护:上游已连接但迟迟不发响应头时同样超时
  })
}

const SKIP_REQUEST_HEADERS = new Set([
  'host', 'content-length', 'connection', 'x-api-key', 'authorization', 'accept-encoding',
])

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_REQUEST_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseJsonBody(body: Buffer): unknown {
  if (body.length === 0) return null
  try { return JSON.parse(body.toString('utf8')) as unknown } catch { return null }
}

function respondJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  if (res.headersSent || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}
