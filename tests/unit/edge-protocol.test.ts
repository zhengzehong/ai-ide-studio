import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/core/config.js'
import {
  isApiToParentMessage,
  isParentToApiMessage,
} from '../../src/edge/protocol.js'

const config = {
  host: '127.0.0.1',
  port: 0,
  dataDir: 'C:/tmp/ai-ide',
  runtime: 'web',
  edgeMode: 'internal',
  edgeRealtimePath: '/realtime',
} as const

describe('Edge API process protocol', () => {
  it('accepts every closed parent-to-child message shape', () => {
    expect(isParentToApiMessage({ type: 'start', config })).toBe(true)
    expect(isParentToApiMessage({
      type: 'start',
      config: { ...config, funAsrWsUrl: 'ws://10.201.80.79:10096/' },
    })).toBe(true)
    expect(isParentToApiMessage({
      type: 'start',
      config: { ...config, dataRetentionMode: 'off' },
    })).toBe(true)
    expect(isParentToApiMessage({
      type: 'start',
      config: { ...config, dataRetentionMode: 'dry-run' },
    })).toBe(true)
    expect(isParentToApiMessage({
      type: 'start',
      config: { ...config, dataRetentionMode: 'delete' },
    })).toBe(true)
    expect(isParentToApiMessage({ type: 'stop' })).toBe(true)
    expect(isParentToApiMessage({ type: 'test.block', requestId: 'req-1', durationMs: 150 })).toBe(true)
    expect(isParentToApiMessage({ type: 'test.realtime.restart', requestId: 'req-2' })).toBe(true)
  })

  it('rejects unknown, incomplete, and extra parent-to-child fields', () => {
    expect(isParentToApiMessage({ type: 'unknown' })).toBe(false)
    expect(isParentToApiMessage({ type: 'start', config: { ...config, port: -1 } })).toBe(false)
    expect(isParentToApiMessage({
      type: 'start',
      config: { ...config, dataRetentionMode: 'invalid' },
    })).toBe(false)
    expect(isParentToApiMessage({ type: 'stop', extra: true })).toBe(false)
    expect(isParentToApiMessage({ type: 'test.block', requestId: '', durationMs: 0 })).toBe(false)
  })

  it('accepts valid child-to-parent lifecycle messages', () => {
    expect(isApiToParentMessage({ type: 'hello' })).toBe(true)
    expect(isApiToParentMessage({
      type: 'ready',
      apiUrl: 'http://127.0.0.1:40100',
      realtimeUrl: 'ws://127.0.0.1:40101',
    })).toBe(true)
    expect(isApiToParentMessage({ type: 'realtime.changed', realtimeUrl: 'ws://127.0.0.1:40102' })).toBe(true)
    expect(isApiToParentMessage({ type: 'test.block.done', requestId: 'req-1' })).toBe(true)
    expect(isApiToParentMessage({ type: 'test.realtime.restart.done', requestId: 'req-2' })).toBe(true)
    expect(isApiToParentMessage({ type: 'stopped' })).toBe(true)
    expect(isApiToParentMessage({ type: 'fatal', message: 'failed' })).toBe(true)
  })

  it('rejects malformed child messages and non-loopback targets', () => {
    expect(isApiToParentMessage({ type: 'ready', apiUrl: 'http://0.0.0.0:18900', realtimeUrl: 'ws://127.0.0.1:1' }))
      .toBe(false)
    expect(isApiToParentMessage({ type: 'realtime.changed', realtimeUrl: 'ws://example.com:18901' })).toBe(false)
    expect(isApiToParentMessage({ type: 'fatal', message: '' })).toBe(false)
    expect(isApiToParentMessage({ type: 'hello', extra: true })).toBe(false)
  })

  it('accepts a start message built from the real loadConfig output', () => {
    // 回归:AppConfig 新增字段必须同步 APP_CONFIG_KEYS 白名单,否则 Edge 握手
    // 的 start 消息会在子进程侧被静默丢弃,启动卡 60s 后 readiness timeout。
    const config = loadConfig()
    const internalConfig = {
      ...config,
      host: '127.0.0.1',
      port: 0,
      edgeMode: 'internal',
      edgeRealtimePath: config.edgeRealtimePath ?? '/realtime',
      realtimeHost: '127.0.0.1',
      realtimePort: 0,
    } as const
    expect(isParentToApiMessage({ type: 'start', config: internalConfig })).toBe(true)
  })
})
