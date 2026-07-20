import type { AppConfig } from '../core/config.js'

export type ParentToApiMessage =
  | { type: 'start'; config: AppConfig }
  | { type: 'stop' }
  | { type: 'test.block'; requestId: string; durationMs: number }
  | { type: 'test.realtime.restart'; requestId: string }

export type ApiToParentMessage =
  | { type: 'hello' }
  | { type: 'ready'; apiUrl: string; realtimeUrl: string }
  | { type: 'realtime.changed'; realtimeUrl: string }
  | { type: 'test.block.done'; requestId: string }
  | { type: 'test.realtime.restart.done'; requestId: string }
  | { type: 'stopped' }
  | { type: 'fatal'; message: string }

const APP_CONFIG_KEYS = new Set([
  'host', 'port', 'dataDir', 'runtime', 'dataWorkerMode', 'dataWorkerSlowMs',
  'dataMaintenanceIntervalMs', 'dataWalCheckpointBytes', 'dataPublishedOutboxRetentionMs',
  'edgeMode', 'edgeRealtimePath', 'realtimeMode', 'realtimeHost', 'realtimePort',
  'realtimeLegacyRpc', 'realtimeMaxQueueMessages', 'realtimeMaxQueueBytes',
  'realtimeMaxBufferedBytes', 'realtimeIpcMaxFrameBytes', 'runtimeMode',
  'runtimeIpcMaxFrameBytes', 'runtimeRestartDelayMs', 'staticDir', 'mobileStaticDir',
  'localToken', 'anthropicApiKey', 'openaiApiKey', 'googleApiKey',
  'bridgeCallbackToken', 'bridgeServerUrl',
])

export function isParentToApiMessage(value: unknown): value is ParentToApiMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'start') {
    return hasOnlyKeys(value, ['type', 'config']) && isAppConfig(value.config)
  }
  if (value.type === 'stop') return hasOnlyKeys(value, ['type'])
  if (value.type === 'test.block') {
    return hasOnlyKeys(value, ['type', 'requestId', 'durationMs'])
      && isNonEmptyString(value.requestId)
      && Number.isInteger(value.durationMs)
      && Number(value.durationMs) > 0
      && Number(value.durationMs) <= 10_000
  }
  if (value.type === 'test.realtime.restart') {
    return hasOnlyKeys(value, ['type', 'requestId']) && isNonEmptyString(value.requestId)
  }
  return false
}

export function isApiToParentMessage(value: unknown): value is ApiToParentMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'hello' || value.type === 'stopped') return hasOnlyKeys(value, ['type'])
  if (value.type === 'ready') {
    return hasOnlyKeys(value, ['type', 'apiUrl', 'realtimeUrl'])
      && isLoopbackEndpoint(value.apiUrl, 'http:')
      && isLoopbackEndpoint(value.realtimeUrl, 'ws:')
  }
  if (value.type === 'realtime.changed') {
    return hasOnlyKeys(value, ['type', 'realtimeUrl']) && isLoopbackEndpoint(value.realtimeUrl, 'ws:')
  }
  if (value.type === 'test.block.done') {
    return hasOnlyKeys(value, ['type', 'requestId']) && isNonEmptyString(value.requestId)
  }
  if (value.type === 'test.realtime.restart.done') {
    return hasOnlyKeys(value, ['type', 'requestId']) && isNonEmptyString(value.requestId)
  }
  if (value.type === 'fatal') {
    return hasOnlyKeys(value, ['type', 'message']) && isNonEmptyString(value.message)
  }
  return false
}

function isAppConfig(value: unknown): value is AppConfig {
  if (!isRecord(value) || ![...Object.keys(value)].every((key) => APP_CONFIG_KEYS.has(key))) return false
  if (!isNonEmptyString(value.host) || !isNonEmptyString(value.dataDir)) return false
  if (!Number.isInteger(value.port) || Number(value.port) < 0 || Number(value.port) > 65_535) return false
  if (value.runtime !== 'web' && value.runtime !== 'electron') return false

  return optionalEnum(value.dataWorkerMode, ['worker', 'local'])
    && optionalEnum(value.edgeMode, ['process', 'disabled', 'internal'])
    && optionalEnum(value.realtimeMode, ['process', 'embedded'])
    && optionalEnum(value.runtimeMode, ['process', 'embedded'])
    && optionalStrings(value, [
      'edgeRealtimePath', 'realtimeHost', 'staticDir', 'mobileStaticDir', 'localToken',
      'anthropicApiKey', 'openaiApiKey', 'googleApiKey', 'bridgeCallbackToken', 'bridgeServerUrl',
    ])
    && optionalBooleans(value, ['realtimeLegacyRpc'])
    && optionalNumbers(value, [
      'dataWorkerSlowMs', 'dataMaintenanceIntervalMs', 'dataWalCheckpointBytes',
      'dataPublishedOutboxRetentionMs', 'realtimePort', 'realtimeMaxQueueMessages',
      'realtimeMaxQueueBytes', 'realtimeMaxBufferedBytes', 'realtimeIpcMaxFrameBytes',
      'runtimeIpcMaxFrameBytes', 'runtimeRestartDelayMs',
    ])
}

function isLoopbackEndpoint(value: unknown, protocol: 'http:' | 'ws:'): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === protocol
      && (url.hostname === '127.0.0.1' || url.hostname === '[::1]')
      && url.port !== ''
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}

function optionalEnum(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || (typeof value === 'string' && allowed.includes(value))
}

function optionalStrings(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => record[key] === undefined || typeof record[key] === 'string')
}

function optionalBooleans(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => record[key] === undefined || typeof record[key] === 'boolean')
}

function optionalNumbers(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => record[key] === undefined || (
    typeof record[key] === 'number' && Number.isFinite(record[key]) && Number(record[key]) >= 0
  ))
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => key in record)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
