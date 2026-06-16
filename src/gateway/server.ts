import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { Server } from 'http'
import { WebSocketServer } from 'ws'
import type { AppConfig } from '../core/config.js'
import { handleWsConnection } from './ws-handler.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { ruleStore } from '../store/rules.js'
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
