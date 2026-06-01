import type { Server } from 'http'
import type { WebSocketServer } from 'ws'
import type { Hono } from 'hono'
import type { AppConfig } from './core/config.js'
import { createChildLogger } from './core/logger.js'
import { ruleEngine } from './core/rules.js'
import { initDatabase } from './store/db.js'
import { agentStore } from './store/agents.js'
import { sessionStore } from './store/sessions.js'
import { seedBuiltinTemplates } from './store/agent-templates.js'
import { seedBuiltinTools } from './tools/seed.js'
import { startGateway } from './gateway/server.js'
import { resolve } from 'path'

const log = createChildLogger('app')

export interface AppHandle {
  app: Hono
  server: Server
  wss: WebSocketServer
  stop: () => Promise<void>
}

export async function startApp(config: AppConfig): Promise<AppHandle> {
  const dbPath = resolve(config.dataDir, 'ai-ide.sqlite')
  initDatabase(dbPath)
  log.info({ dbPath }, '数据库已初始化')
  const recovery = sessionStore.reconcileInterruptedStages()
  if (recovery.interrupted.length > 0 || recovery.cleared.length > 0) {
    log.warn(
      { interrupted: recovery.interrupted.length, cleared: recovery.cleared.length },
      '\u5df2\u4fee\u590d\u91cd\u542f\u9057\u7559\u7684\u4f1a\u8bdd\u751f\u6210\u72b6\u6001',
    )
  }

  seedDefaultAgents()
  seedBuiltinTemplates()
  seedBuiltinTools()

  const { app, server, wss } = await startGateway(config)
  ruleEngine.start()
  log.info(
    { host: config.host, port: config.port, http: `http://${config.host}:${config.port}`, ws: `ws://${config.host}:${config.port}` },
    '服务已启动',
  )

  let stopped = false

  return {
    app,
    server,
    wss,
    stop: async () => {
      if (stopped) return
      stopped = true
      ruleEngine.stop()
      await closeWebSocketServer(wss)
      await closeHttpServer(server)
      log.info('服务已关闭')
    },
  }
}

function seedDefaultAgents(): void {
  const defaults = [
    { id: 'claude-dev', type: 'dev', name: 'Claude (开发)', runtime: 'claude' },
    { id: 'codex-dev', type: 'dev', name: 'Codex (开发)', runtime: 'codex' },
    { id: 'mock-dev', type: 'dev', name: 'Mock (测试)', runtime: 'mock' },
  ]

  for (const def of defaults) {
    agentStore.upsert(def)
  }
  log.info({ count: defaults.length }, '默认 Agent 已初始化')
}

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()

  return new Promise((resolveClose, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolveClose()
    })
  })
}

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolveClose, reject) => {
    wss.close((err) => {
      if (err && err.message !== 'Server is not running.') reject(err)
      else resolveClose()
    })
  })
}
