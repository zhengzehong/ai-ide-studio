import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'
import { parseDataWorkerSlowMs } from '../data-worker/observability.js'

export type AppRuntime = 'web' | 'electron'
export type DataWorkerMode = 'worker' | 'local'
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
  staticDir?: string
  mobileStaticDir?: string
  localToken?: string
  anthropicApiKey?: string
  openaiApiKey?: string
  googleApiKey?: string
  bridgeCallbackToken?: string
  bridgeServerUrl?: string
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
    staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : resolve('./ui/dist'),
    mobileStaticDir: process.env.MOBILE_STATIC_DIR ? resolve(process.env.MOBILE_STATIC_DIR) : resolve('./mobile/dist'),
    localToken: process.env.AI_IDE_LOCAL_TOKEN || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    googleApiKey: process.env.GOOGLE_API_KEY || undefined,
    bridgeCallbackToken: process.env.BRIDGE_CALLBACK_TOKEN || undefined,
    bridgeServerUrl: process.env.BRIDGE_SERVER_URL || undefined,
  }
}

function parseDataWorkerMode(value: string | undefined): DataWorkerMode {
  return value === 'local' ? 'local' : 'worker'
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
