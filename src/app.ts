import type { Server } from 'http'
import type { WebSocketServer } from 'ws'
import type { Hono } from 'hono'
import type { AppConfig, DataWorkerMode } from './core/config.js'
import { createChildLogger, getLogConfig } from './core/logger.js'
import { ruleEngine } from './core/rules.js'
import { closeDatabase, initDatabase } from './store/db.js'
import { agentStore } from './store/agents.js'
import { sessionStore } from './store/sessions.js'
import { seedBuiltinTemplates } from './store/agent-templates.js'
import { seedBuiltinTaskExecutionModes } from './store/seed-task-execution-modes.js'
import { seedBuiltinTools } from './tools/seed.js'
import { startGateway } from './gateway/server.js'
import { initTimeline } from './core/timeline.js'
import { getOrCreateMachineId, agentHubService } from './core/agent-hub/index.js'
import { resolve } from 'path'
import { createWorkerQueryPort } from './queries/worker-query-port.js'
import { setQueryPort } from './queries/query-port-provider.js'
import { sessionManager } from './core/sessions.js'
import { createWorkerWriteDataPort } from './data-worker/writer-worker/client.js'
import { setWriteDataPort } from './core/persistence/write-data-port-provider.js'
import { sessionPersistencePort } from './core/persistence/session-persistence-port.js'
import type { QueryPort } from './ports/query-port.js'
import type { WriteDataPort } from './ports/write-data-port.js'
import { localQueryPort } from './queries/local-query-port.js'
import { localWriteDataPort } from './core/persistence/local-write-data-port.js'

const log = createChildLogger('app')

export interface AppHandle {
  app: Hono
  server: Server
  wss: WebSocketServer
  dataWorkerMode: DataWorkerMode
  stop: () => Promise<void>
}

interface AppDataPorts {
  queryPort: QueryPort
  writeDataPort: WriteDataPort
  close: () => Promise<void>
}

export async function startApp(config: AppConfig): Promise<AppHandle> {
  const dbPath = resolve(config.dataDir, 'ai-ide.sqlite')
  initDatabase(dbPath)
  log.info({ dbPath }, '数据库已初始化')
  log.info({ dataDir: config.dataDir, ...getLogConfig() }, '日志配置已加载')
  const recovery = sessionStore.reconcileInterruptedStages()
  if (recovery.interrupted.length > 0 || recovery.cleared.length > 0) {
    log.warn(
      { interrupted: recovery.interrupted.length, cleared: recovery.cleared.length },
      '\u5df2\u4fee\u590d\u91cd\u542f\u9057\u7559\u7684\u4f1a\u8bdd\u751f\u6210\u72b6\u6001',
    )
  }

  seedDefaultAgents()
  seedBuiltinTemplates()
  seedBuiltinTaskExecutionModes()
  seedBuiltinTools()

  const dataWorkerMode = config.dataWorkerMode ?? 'worker'
  let dataPorts: AppDataPorts
  try {
    dataPorts = await startDataPorts(dataWorkerMode, dbPath, config.dataWorkerSlowMs)
  } catch (err) {
    closeDatabase()
    throw err
  }
  const { queryPort, writeDataPort } = dataPorts
  const resetWriteDataPort = setWriteDataPort(writeDataPort)
  const resetQueryPort = setQueryPort(queryPort)

  void getOrCreateMachineId().then(
    (machineId) => log.info({ machineId }, 'machineId 已就绪'),
    (err) => log.warn({ err }, '预热 machineId 失败,首次 connect 时再生成'),
  )

  void agentHubService.reconnectAll().then(
    () => log.info('Hub 连接恢复完成'),
    (err) => log.warn({ err }, 'Hub 连接恢复失败,不阻塞启动'),
  )

  let gateway: Awaited<ReturnType<typeof startGateway>>
  try {
    gateway = await startGateway(config, { queryPort })
  } catch (err) {
    resetQueryPort()
    resetWriteDataPort()
    await dataPorts.close()
    closeDatabase()
    throw err
  }
  const { app, server, wss } = gateway
  ruleEngine.start()
  initTimeline()
  log.info(
    { host: config.host, port: config.port, http: `http://${config.host}:${config.port}`, ws: `ws://${config.host}:${config.port}` },
    '服务已启动',
  )

  let stopped = false
  const hubCleanupTimer = agentHubService.startCleanupTimer()

  return {
    app,
    server,
    wss,
    dataWorkerMode,
    stop: async () => {
      if (stopped) return
      stopped = true
      ruleEngine.stop()
      clearInterval(hubCleanupTimer)
      const cleanupErrors: unknown[] = []
      await collectCleanupError(cleanupErrors, () => closeWebSocketServer(wss))
      await collectCleanupError(cleanupErrors, () => closeHttpServer(server))
      await collectCleanupError(cleanupErrors, () => sessionPersistencePort.flush())
      resetQueryPort()
      resetWriteDataPort()
      await collectCleanupError(cleanupErrors, () => dataPorts.close())
      sessionPersistencePort.reset()
      closeDatabase()
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, 'Application shutdown completed with errors')
      }
      log.info('服务已关闭')
    },
  }
}

async function collectCleanupError(
  errors: unknown[],
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    errors.push(error)
  }
}

async function startDataPorts(
  mode: DataWorkerMode,
  dbPath: string,
  slowRequestMs?: number,
): Promise<AppDataPorts> {
  if (mode === 'local') {
    return {
      queryPort: localQueryPort,
      writeDataPort: localWriteDataPort,
      close: async () => undefined,
    }
  }

  const writeDataPort = await createWorkerWriteDataPort({ dbPath, slowRequestMs })
  try {
    const queryPort = await createWorkerQueryPort({
      dbPath,
      getActivePromptSessionIds: () => sessionManager.listActivePromptSessionIds(),
      slowRequestMs,
    })
    return {
      queryPort,
      writeDataPort,
      close: async () => {
        await queryPort.close()
        await writeDataPort.close()
      },
    }
  } catch (err) {
    await writeDataPort.close()
    throw err
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
