import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'
import { parseDataWorkerSlowMs } from '../data-worker/observability.js'
import type { DataRetentionMode } from '../data-retention/retention-service.js'

export type AppRuntime = 'web' | 'electron'
export type DataWorkerMode = 'worker' | 'local'
export type EdgeMode = 'process' | 'disabled' | 'internal'
export type RealtimeMode = 'process' | 'embedded'
export type RuntimeMode = 'process' | 'embedded'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  runtime: AppRuntime
  dataWorkerMode?: DataWorkerMode
  dataWorkerSlowMs?: number
  dataMaintenanceIntervalMs?: number
  dataWalCheckpointBytes?: number
  dataPublishedOutboxRetentionMs?: number
  /** writer_batch_commits(批次幂等账本)保留窗口;0 = 不清理。 */
  dataBatchCommitRetentionMs?: number
  dataRetentionMode?: DataRetentionMode
  modelCaptureProxyPort?: number
  edgeMode?: EdgeMode
  edgeRealtimePath?: string
  realtimeMode?: RealtimeMode
  realtimeHost?: string
  realtimePort?: number
  realtimeLegacyRpc?: boolean
  realtimeMaxQueueMessages?: number
  realtimeMaxQueueBytes?: number
  realtimeMaxBufferedBytes?: number
  realtimeIpcMaxFrameBytes?: number
  runtimeMode?: RuntimeMode
  runtimeIpcMaxFrameBytes?: number
  runtimeRestartDelayMs?: number
  runtimeIdleSweepMs?: number
  runtimeSessionIdleMs?: number
  runtimeAgentIdleMs?: number
  /**
   * 挂起回合自动收敛(级别 b,默认关闭):存在排队消息 + 无任何流事件/心跳 ≥
   * promptStuckAutoRecoverMs 时,走"置终态 + 清 activePrompt + drain 队列"的
   * 死亡清理同款路径。默认关闭的原因:活着的回合可以长静默后仍产出真答案,
   * 自动结束会丢掉后续产出(2026-09-17 sess-d83044f2 事故评审结论)。
   */
  promptStuckAutoRecoverEnabled?: boolean
  /** 自动收敛的静默阈值(毫秒);默认 30 分钟,不允许低于 30 分钟。 */
  promptStuckAutoRecoverMs?: number
  staticDir?: string
  mobileStaticDir?: string
  localToken?: string
  anthropicApiKey?: string
  openaiApiKey?: string
  googleApiKey?: string
  bridgeCallbackToken?: string
  bridgeServerUrl?: string
  funAsrWsUrl?: string
}

export function loadConfig(): AppConfig {
  loadDotenv()
  const runtime = parseRuntime(process.env.AI_IDE_RUNTIME)
  const port = parseInt(process.env.PORT || '18800', 10)

  return {
    host: process.env.HOST || defaultHost(runtime),
    port,
    dataDir: resolve(process.env.DATA_DIR || './data'),
    runtime,
    dataWorkerMode: parseDataWorkerMode(process.env.DATA_WORKER_MODE),
    dataWorkerSlowMs: parseDataWorkerSlowMs(process.env.DATA_WORKER_SLOW_MS),
    dataMaintenanceIntervalMs: parsePositiveInteger(process.env.DATA_MAINTENANCE_INTERVAL_MS, 60_000),
    dataWalCheckpointBytes: parsePositiveInteger(process.env.DATA_WAL_CHECKPOINT_BYTES, 64 * 1024 * 1024),
    dataPublishedOutboxRetentionMs: parsePositiveInteger(
      process.env.DATA_PUBLISHED_OUTBOX_RETENTION_MS,
      7 * 24 * 60 * 60 * 1000,
    ),
    dataBatchCommitRetentionMs: parsePositiveInteger(
      process.env.DATA_BATCH_COMMIT_RETENTION_MS,
      7 * 24 * 60 * 60 * 1000,
    ),
    dataRetentionMode: parseDataRetentionMode(process.env.DATA_RETENTION_MODE),
    modelCaptureProxyPort: parsePositiveInteger(process.env.MODEL_CAPTURE_PROXY_PORT, 3090),
    edgeMode: process.env.EDGE_MODE === 'disabled' ? 'disabled' : 'process',
    edgeRealtimePath: normalizePublicPath(process.env.EDGE_REALTIME_PATH),
    realtimeMode: process.env.REALTIME_MODE === 'embedded' ? 'embedded' : 'process',
    realtimeHost: process.env.REALTIME_HOST || defaultHost(runtime),
    realtimePort: parseNonNegativeInteger(process.env.REALTIME_PORT, port === 0 ? 0 : port + 1),
    realtimeLegacyRpc: process.env.REALTIME_LEGACY_RPC !== 'disabled',
    realtimeMaxQueueMessages: parsePositiveInteger(process.env.REALTIME_MAX_QUEUE_MESSAGES, 500),
    realtimeMaxQueueBytes: parsePositiveInteger(process.env.REALTIME_MAX_QUEUE_BYTES, 2 * 1024 * 1024),
    realtimeMaxBufferedBytes: parsePositiveInteger(process.env.REALTIME_MAX_BUFFERED_BYTES, 2 * 1024 * 1024),
    realtimeIpcMaxFrameBytes: parsePositiveInteger(process.env.REALTIME_IPC_MAX_FRAME_BYTES, 16 * 1024 * 1024),
    runtimeMode: process.env.RUNTIME_SERVICE_MODE === 'embedded' ? 'embedded' : 'process',
    runtimeIpcMaxFrameBytes: parsePositiveInteger(process.env.RUNTIME_IPC_MAX_FRAME_BYTES, 16 * 1024 * 1024),
    runtimeRestartDelayMs: parsePositiveInteger(process.env.RUNTIME_RESTART_DELAY_MS, 250),
    runtimeIdleSweepMs: parsePositiveInteger(process.env.RUNTIME_IDLE_SWEEP_MS, 5 * 60 * 1000),
    runtimeSessionIdleMs: parsePositiveInteger(process.env.RUNTIME_SESSION_IDLE_MS, 30 * 60 * 1000),
    runtimeAgentIdleMs: parsePositiveInteger(process.env.RUNTIME_AGENT_IDLE_MS, 60 * 60 * 1000),
    promptStuckAutoRecoverEnabled: process.env.PROMPT_STUCK_AUTO_RECOVER === 'enabled',
    promptStuckAutoRecoverMs: parsePositiveInteger(process.env.PROMPT_STUCK_RECOVER_MS, 30 * 60 * 1000),
    staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : resolve('./ui/dist'),
    mobileStaticDir: process.env.MOBILE_STATIC_DIR ? resolve(process.env.MOBILE_STATIC_DIR) : resolve('./mobile/dist'),
    localToken: process.env.AI_IDE_LOCAL_TOKEN || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    googleApiKey: process.env.GOOGLE_API_KEY || undefined,
    bridgeCallbackToken: process.env.BRIDGE_CALLBACK_TOKEN || undefined,
    bridgeServerUrl: process.env.BRIDGE_SERVER_URL || undefined,
    funAsrWsUrl: normalizeOptionalWebSocketUrl(process.env.FUNASR_WS_URL),
  }
}

function normalizeOptionalWebSocketUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('FUNASR_WS_URL must use ws:// or wss://')
  }
  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''
  return parsed.toString()
}

function normalizePublicPath(value: string | undefined): string {
  const trimmed = value?.trim() || '/realtime'
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  if (prefixed.includes('?') || prefixed.includes('#')) {
    throw new Error('EDGE_REALTIME_PATH must not contain a query string or fragment')
  }
  return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed
}

function parseDataWorkerMode(value: string | undefined): DataWorkerMode {
  return value === 'local' ? 'local' : 'worker'
}

function parseDataRetentionMode(value: string | undefined): DataRetentionMode {
  if (value === 'dry-run' || value === 'delete') return value
  return 'off'
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function parseRuntime(value: string | undefined): AppRuntime {
  return value === 'electron' ? 'electron' : 'web'
}

function defaultHost(runtime: AppRuntime): string {
  return runtime === 'electron' ? '127.0.0.1' : '0.0.0.0'
}
