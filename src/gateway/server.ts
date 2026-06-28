import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import type { Server } from 'http'
import { WebSocketServer } from 'ws'
import { Readable } from 'stream'
import { basename } from 'path'
import type { AppConfig } from '../core/config.js'
import { handleWsConnection } from './ws-handler.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { ruleStore } from '../store/rules.js'
import { projectStore } from '../store/projects.js'
import { getAssetStream } from '../core/filesystem.js'
import { getImageAsset } from '../core/image-attachments.js'
import { mountHttpMcpServer } from '../tools/mcp/http-mcp-server.js'
import { mountStaticAssets, staticDirForLog } from './static-assets.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('gateway')

export async function startGateway(config: AppConfig) {
  const app = new Hono()

  mountLocalTokenGuard(app, config)

  app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }))

  app.get('/api/agents', (c) => c.json(agentStore.list()))
  app.get('/api/sessions', (c) => {
    const agentId = c.req.query('agentId')
    return c.json(sessionStore.list(agentId))
  })
  app.get('/api/tasks', (c) => {
    const status = c.req.query('status')
    return c.json(taskStore.list(status))
  })

  app.get('/api/rules', (c) => c.json(ruleStore.list()))
  app.get('/api/fs/asset', (c) => handleFsAsset(c))
  app.get('/api/images/*', (c) => handleImageAsset(c))
  mountHttpMcpServer(app)
  mountStaticAssets(app, config)
  log.debug({ staticDir: staticDirForLog(config) }, '静态资源托载检查完成')

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }) as Server

  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws, req) => {
    if (!isWsAuthorized(req, config)) {
      ws.close(1008, '未授权')
      return
    }
    handleWsConnection(ws, req, wss)
  })

  return { app, server, wss }
}

function handleImageAsset(c: Context): Response {
  const relativePath = c.req.path.replace(/^\/api\/images\/?/, '')
  const decodedPath = decodePath(relativePath)
  if (decodedPath == null) {
    return c.json({ error: '图片路径无效' }, 400)
  }
  const asset = getImageAsset(decodedPath)
  if (!asset) {
    return c.json({ error: '图片不存在或无法读取' }, 404)
  }

  c.header('Content-Type', asset.mimeType)
  c.header('Content-Length', String(asset.size))
  c.header('Cache-Control', 'private, max-age=86400')

  const nodeStream = asset.stream as Readable
  const webStream = nodeStreamToWebStream(nodeStream)
  return new Response(webStream, {
    status: 200,
    headers: c.res.headers,
  })
}

function decodePath(path: string): string | null {
  try {
    return decodeURIComponent(path)
  } catch {
    return null
  }
}

function handleFsAsset(c: Context): Response {
  const projectId = c.req.query('projectId')
  const filePath = c.req.query('path')
  const mode = c.req.query('mode') === 'attachment' ? 'attachment' : 'inline'
  if (!projectId || !filePath) {
    return c.json({ error: '缺少 projectId 或 path' }, 400)
  }
  const project = projectStore.get(projectId)
  if (!project) {
    return c.json({ error: '项目不存在' }, 404)
  }
  const asset = getAssetStream(project.work_dir, filePath)
  if (!asset) {
    return c.json({ error: '文件不存在或无法读取' }, 404)
  }

  const filename = basename(filePath)
  const dispositionFilename = encodeURIComponent(filename).replace(/['()]/g, '').replace(/%20/g, ' ')
  const disposition = `${mode}; filename="${dispositionFilename}"; filename*=UTF-8''${dispositionFilename}`
  c.header('Content-Type', asset.mimeType)
  c.header('Content-Length', String(asset.size))
  c.header('Content-Disposition', disposition)
  c.header('Cache-Control', 'no-store')

  const nodeStream = asset.stream as Readable
  const webStream = nodeStreamToWebStream(nodeStream)

  return new Response(webStream, {
    status: 200,
    headers: c.res.headers,
  })
}

function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const onData = (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk))
        } catch {
          nodeStream.destroy()
        }
      }
      const onEnd = () => {
        try { controller.close() } catch { /* ignore */ }
        cleanup()
      }
      const onError = (err: unknown) => {
        try { controller.error(err) } catch { /* ignore */ }
        cleanup()
      }
      const cleanup = () => {
        nodeStream.off('data', onData)
        nodeStream.off('end', onEnd)
        nodeStream.off('error', onError)
      }
      nodeStream.on('data', onData)
      nodeStream.on('end', onEnd)
      nodeStream.on('error', onError)
    },
    cancel() {
      try { nodeStream.destroy() } catch { /* ignore */ }
    },
  })
}

function mountLocalTokenGuard(app: Hono, config: AppConfig): void {
  if (!config.localToken) return

  app.use('*', async (c, next) => {
    if (isAssetRequest(c.req.path)) {
      await next()
      return
    }

    const token = c.req.header('x-ai-ide-token') ?? c.req.query('token')
    if (token !== config.localToken) return c.json({ error: '未授权' }, 401)
    await next()
  })
}

function isAssetRequest(path: string): boolean {
  return !path.startsWith('/api/') && path !== '/health'
}

function isWsAuthorized(req: { url?: string; headers: { [key: string]: string | string[] | undefined } }, config: AppConfig): boolean {
  if (!config.localToken) return true
  const header = req.headers['x-ai-ide-token']
  if (header === config.localToken || (Array.isArray(header) && header.includes(config.localToken))) return true
  const token = new URL(req.url ?? '/', `http://${config.host}:${config.port}`).searchParams.get('token')
  return token === config.localToken
}
