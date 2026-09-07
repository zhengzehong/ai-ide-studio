import type { Server } from 'http'
import type { WebSocketServer } from 'ws'
import type { AppConfig, DataWorkerMode, RuntimeMode } from './core/config.js'
import type { AppHandle } from './app-handle.js'
import { createChildLogger, getLogConfig } from './core/logger.js'
import { ruleEngine } from './core/rules.js'
import { closeDatabase, initDatabase } from './store/db.js'
import { sessionStore } from './store/sessions.js'
import { reconcileAgentPrimarySessions, seedDefaultAgents } from './core/agent-primary-sessions.js'
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
import { createLocalWriteDataPort } from './core/persistence/local-write-data-port.js'
import { createRealtimeProcess, type RealtimeProcessHandle } from './realtime/process-client.js'
import { createRealtimeRpcBridge } from './gateway/realtime-rpc-bridge.js'
import { createRealtimeEventSource, type RealtimeEventSource } from './gateway/realtime-event-source.js'
import { sessionShareStore } from './store/session-shares.js'
import type { RuntimePort } from './ports/runtime-port.js'
import { EmbeddedRuntimePort } from './runtime/api/embedded-runtime-port.js'
import { createProcessRuntimePort, type ProcessRuntimePort } from './runtime/api/process-runtime-port.js'
import { handleRuntimeAgentStatus, handleRuntimeDone, handleRuntimePersistenceUpdate } from './runtime/api/runtime-ingress.js'
import { setRuntimePort } from './runtime/runtime-port-provider.js'
import { RuntimeCommandDispatcher } from './commands/runtime-command-dispatcher.js'
import { executeSessionCommand } from './commands/session-command-service.js'
import { startWriterMaintenanceLoop } from './data-worker/writer-maintenance-loop.js'
import { createEventLoopMonitor, eventLoopMonitorOptions } from './shared/event-loop-monitor.js'
import { operationDiagnosticsContext } from './shared/operation-diagnostics.js'
import { listActivePromptDiagnostics } from './core/prompt-diagnostics.js'
import { resumeProjectSecretaryRuns } from './core/project-secretary.js'
import { resumeProjectInspirations } from './core/project-inspiration.js'
import { handleSessionTurnDone, resumeProjectAdvisors } from './core/project-advisor.js'
import { events } from './core/events.js'
import { DataRetentionService } from './data-retention/retention-service.js'
import { closeSharedFileChangeWorker } from './core/file-change-worker-client.js'
import { getOrCreateRetentionControlToken } from './data-retention/control-token.js'
import {
  createRealtimeEndpointSubscription,
  embeddedRealtimeEndpoint,
  httpServerEndpoint,
  restartRealtimeForTest,
  serverPort,
} from './app-endpoints.js'

const log = createChildLogger('app')

export type { AppHandle } from './app-handle.js'

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
  reconcileAgentPrimarySessions()
  seedBuiltinTemplates()
  seedBuiltinTaskExecutionModes()
  seedBuiltinTools()

  const dataWorkerMode = config.dataWorkerMode ?? 'worker'
  let dataPorts: AppDataPorts
  try {
    dataPorts = await startDataPorts(dataWorkerMode, dbPath, config)
  } catch (err) {
    closeDatabase()
    throw err
  }
  const { queryPort, writeDataPort } = dataPorts
  const resetWriteDataPort = setWriteDataPort(writeDataPort)
  const resetQueryPort = setQueryPort(queryPort)

  const realtimeMode = config.realtimeMode ?? 'process'
  let realtimeProcess: RealtimeProcessHandle | undefined
  let realtimeEvents: RealtimeEventSource | undefined
  if (realtimeMode === 'process') {
    try {
      realtimeProcess = await createRealtimeProcess({
        host: config.realtimeHost ?? config.host,
        port: config.realtimePort ?? (config.port === 0 ? 0 : config.port + 1),
        legacyRpcEnabled: config.realtimeLegacyRpc ?? true,
        maxQueueMessages: config.realtimeMaxQueueMessages,
        maxQueueBytes: config.realtimeMaxQueueBytes,
        maxBufferedBytes: config.realtimeMaxBufferedBytes,
        maxFrameBytes: config.realtimeIpcMaxFrameBytes,
        authenticate: async (request) => resolveRealtimeClaims(config, request),
        dispatchLegacyRpc: createRealtimeRpcBridge(),
      })
      realtimeEvents = createRealtimeEventSource((delivery) => realtimeProcess?.sendDelivery(delivery))
    } catch (err) {
      resetQueryPort()
      resetWriteDataPort()
      await dataPorts.close()
      closeDatabase()
      throw err
    }
  }

  const runtimeMode: RuntimeMode = config.runtimeMode ?? (realtimeMode === 'embedded' ? 'embedded' : 'process')
  if (runtimeMode === 'process' && !realtimeProcess) {
    realtimeEvents?.stop()
    resetQueryPort()
    resetWriteDataPort()
    await dataPorts.close()
    closeDatabase()
    throw new Error('Process Runtime requires process Realtime')
  }
  let runtimePort: RuntimePort
  let processRuntime: ProcessRuntimePort | undefined
  try {
    if (runtimeMode === 'process') {
      const realtime = realtimeProcess as RealtimeProcessHandle
      processRuntime = await createProcessRuntimePort({
        realtimeStreamEndpoint: realtime.runtimeStreamEndpoint,
        realtimeStreamToken: realtime.runtimeStreamToken,
        maxFrameBytes: config.runtimeIpcMaxFrameBytes,
        restartDelayMs: config.runtimeRestartDelayMs,
        idleSweepIntervalMs: config.runtimeIdleSweepMs,
        sessionIdleMs: config.runtimeSessionIdleMs,
        agentIdleMs: config.runtimeAgentIdleMs,
        onPersistenceUpdate: handleRuntimePersistenceUpdate,
        onDone: handleRuntimeDone,
        onAgentStatus: handleRuntimeAgentStatus,
      })
      runtimePort = processRuntime
    } else {
      runtimePort = new EmbeddedRuntimePort()
    }
  } catch (err) {
    realtimeEvents?.stop()
    await realtimeProcess?.close()
    resetQueryPort()
    resetWriteDataPort()
    await dataPorts.close()
    closeDatabase()
    throw err
  }
  const resetRuntimePort = setRuntimePort(runtimePort)
  const commandDispatcher = new RuntimeCommandDispatcher({
    ledger: writeDataPort,
    execute: async (command) => {
      await executeSessionCommand(command)
    },
  })
  try {
    await commandDispatcher.start()
  } catch (err) {
    await runtimePort.close().catch(() => undefined)
    resetRuntimePort()
    realtimeEvents?.stop()
    await realtimeProcess?.close()
    resetQueryPort()
    resetWriteDataPort()
    await dataPorts.close()
    closeDatabase()
    throw err
  }

  void getOrCreateMachineId().then(
    (machineId) => log.info({ machineId }, 'machineId 已就绪'),
    (err) => log.warn({ err }, '预热 machineId 失败,首次 connect 时再生成'),
  )

  void agentHubService.reconnectAll().then(
    () => log.info('Hub 连接恢复完成'),
    (err) => log.warn({ err }, 'Hub 连接恢复失败,不阻塞启动'),
  )

  let gateway: Awaited<ReturnType<typeof startGateway>>
  let embeddedRealtimePort = 0
  const retention = new DataRetentionService({
    writeDataPort,
    mode: config.dataRetentionMode ?? 'off',
  })
  const retentionControlToken = getOrCreateRetentionControlToken(config.dataDir)
  try {
    gateway = await startGateway(config, {
      queryPort,
      webSocketMode: realtimeMode === 'embedded' ? 'embedded' : 'none',
      realtimeState: () => ({
        mode: realtimeMode,
        host: realtimeMode === 'process' ? (config.realtimeHost ?? config.host) : config.host,
        port: realtimeMode === 'process' ? (realtimeProcess?.port ?? 0) : embeddedRealtimePort,
        publicPath: config.edgeMode === 'internal' ? config.edgeRealtimePath : undefined,
        legacyRpcEnabled: config.realtimeLegacyRpc ?? true,
      }),
      commandDispatcher,
      retention,
      retentionControlToken,
    })
    embeddedRealtimePort = serverPort(gateway.server)
  } catch (err) {
    await runtimePort.close().catch(() => undefined)
    resetRuntimePort()
    realtimeEvents?.stop()
    await realtimeProcess?.close()
    resetQueryPort()
    resetWriteDataPort()
    await dataPorts.close()
    closeDatabase()
    throw err
  }
  const { app, server, wss } = gateway
  const httpEndpoint = httpServerEndpoint(config.host, server)
  const initialRealtimeEndpoint =
    realtimeMode === 'process'
      ? (realtimeProcess as RealtimeProcessHandle).endpointUrl
      : embeddedRealtimeEndpoint(config.host, server)
  const onRealtimeEndpointChange = createRealtimeEndpointSubscription(
    realtimeMode,
    realtimeProcess,
    initialRealtimeEndpoint,
  )
  ruleEngine.start()
  void resumeProjectSecretaryRuns().catch((err: unknown) => log.warn({ err }, '秘书待处理运行恢复失败'))
  void resumeProjectInspirations().catch((err: unknown) => log.warn({ err }, '灵感待整理记录恢复失败'))
  void resumeProjectAdvisors().catch((err: unknown) => log.warn({ err }, '参谋派发占用恢复失败'))
  events.on('session:done', (ev) => handleSessionTurnDone(ev))
  initTimeline()
  log.info(
    {
      host: config.host,
      port: config.port,
      http: httpEndpoint,
      realtimeMode,
      runtimeMode,
      realtimeEndpoint: initialRealtimeEndpoint,
    },
    '服务已启动',
  )

  let stopped = false
  const hubCleanupTimer = agentHubService.startCleanupTimer()
  const maintenanceLoop = startWriterMaintenanceLoop(writeDataPort, config.dataMaintenanceIntervalMs)
  retention.start()
  const eventLoopMonitor = createEventLoopMonitor(
    eventLoopMonitorOptions('api', () => ({
      activePromptCount: sessionManager.listActivePromptSessionIds().length,
      ...operationDiagnosticsContext(),
    })),
  )
  eventLoopMonitor.start()

  return {
    app,
    server,
    wss,
    dataWorkerMode,
    realtimeMode,
    runtimeMode,
    httpEndpoint,
    get realtimeEndpoint(): string {
      return realtimeMode === 'process'
        ? (realtimeProcess as RealtimeProcessHandle).endpointUrl
        : initialRealtimeEndpoint
    },
    listActivePromptDiagnostics,
    onRealtimeEndpointChange,
    restartRealtimeForTest: () => restartRealtimeForTest(realtimeMode, realtimeProcess),
    stop: async () => {
      if (stopped) return
      stopped = true
      maintenanceLoop.stop()
      eventLoopMonitor.stop()
      ruleEngine.stop()
      clearInterval(hubCleanupTimer)
      const cleanupErrors: unknown[] = []
      await collectCleanupError(cleanupErrors, () => retention.close())
      realtimeEvents?.stop()
      commandDispatcher.closeIntake()
      gateway.devices?.close()
      if (wss) await collectCleanupError(cleanupErrors, () => closeWebSocketServer(wss))
      await collectCleanupError(cleanupErrors, () => gateway.funAsrProxy.close())
      await collectCleanupError(cleanupErrors, () => commandDispatcher.drain())
      await collectCleanupError(cleanupErrors, () => runtimePort.drain())
      await collectCleanupError(cleanupErrors, () => runtimePort.close())
      await collectCleanupError(cleanupErrors, () => closeSharedFileChangeWorker())
      resetRuntimePort()
      if (realtimeProcess) await collectCleanupError(cleanupErrors, () => realtimeProcess.close())
      await collectCleanupError(cleanupErrors, () => closeHttpServer(server))
      await collectCleanupError(cleanupErrors, () => sessionPersistencePort.flush())
      await collectCleanupError(cleanupErrors, async () => {
        await writeDataPort.maintain({ force: true })
      })
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

async function resolveRealtimeClaims(
  config: AppConfig,
  request: { token?: string; shareToken?: string; guestId?: string; guestName?: string },
): Promise<
  | {
      authMode: 'owner' | 'guest'
      shareToken?: string
      guestId?: string
      guestName?: string
      sessionId?: string
      toolCallVisibility?: 'show' | 'hide'
    }
  | undefined
> {
  if (request.shareToken) {
    const share = sessionShareStore.getByToken(request.shareToken)
    if (!share) return undefined
    return {
      authMode: 'guest',
      shareToken: request.shareToken,
      guestId: request.guestId,
      guestName: request.guestName,
      sessionId: share.session_id,
      toolCallVisibility: share.tool_call_visibility === 'hide' ? 'hide' : 'show',
    }
  }
  if (config.localToken && request.token !== config.localToken) return undefined
  return { authMode: 'owner' }
}

async function collectCleanupError(errors: unknown[], cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    errors.push(error)
  }
}

async function startDataPorts(mode: DataWorkerMode, dbPath: string, config: AppConfig): Promise<AppDataPorts> {
  const maintenanceConfig = {
    walCheckpointBytes: config.dataWalCheckpointBytes,
    publishedOutboxRetentionMs: config.dataPublishedOutboxRetentionMs,
  }
  if (mode === 'local') {
    return {
      queryPort: localQueryPort,
      writeDataPort: createLocalWriteDataPort(maintenanceConfig),
      close: async () => undefined,
    }
  }

  const writeDataPort = await createWorkerWriteDataPort({
    dbPath,
    slowRequestMs: config.dataWorkerSlowMs,
    ...maintenanceConfig,
  })
  try {
    const queryPort = await createWorkerQueryPort({
      dbPath,
      getActivePromptSessionIds: () => sessionManager.listActivePromptSessionIds(),
      slowRequestMs: config.dataWorkerSlowMs,
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
