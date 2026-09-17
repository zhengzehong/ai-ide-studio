import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  configurePromptWatchdog,
  finishPromptDiagnostics,
  getPromptDiagnosticState,
  recordPromptProgress,
  startPromptDiagnostics,
} from '../../src/core/prompt-diagnostics.js'

/**
 * 看门狗分级自愈的条件回归(2026-09-17 sess-d83044f2 事故):
 * - 级别 a(人工)不在这里,由 sessions.forceFinishPrompt 提供;
 * - 级别 b 必须同时满足:启用 + 流事件静默 ≥ 阈值(下限 30min)+ 存在排队消息。
 *   静默窗口只由 recordPromptProgress(所有上行流帧)重置——ACP 工具心跳只存在于
 *   runtime 子进程,API 进程侧不再保留永不生效的心跳否决位(N2/P2-6)。
 * 单文件共用一个 fake clock(看门狗 interval 只在首个 start 时创建)。
 */
const SESSION = 'sess-watchdog'
const MINUTE = 60 * 1000

let forceFinishCalls: string[] = []
let queued = false

function configure(enabled: boolean, silentMs?: number): void {
  configurePromptWatchdog({
    autoRecoverEnabled: enabled,
    ...(silentMs !== undefined ? { autoRecoverSilentMs: silentMs } : {}),
    hooks: {
      hasQueuedMessages: () => queued,
      forceFinish: (sessionId, reason) => {
        forceFinishCalls.push(`${sessionId}:${reason}`)
      },
    },
  })
}

function startTurn(): void {
  const now = Date.now()
  startPromptDiagnostics({
    turnId: 'turn-1',
    sessionId: SESSION,
    agentId: 'agent-1',
    startedAt: now,
    lastProgressAt: now,
    lastProgress: 'prompt.received',
  })
}

async function advance(minutes: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(minutes * MINUTE)
}

beforeAll(() => {
  vi.useFakeTimers({ now: 0 })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  forceFinishCalls = []
  queued = false
  finishPromptDiagnostics(SESSION, 'prompt-done')
})

describe('prompt watchdog auto recover', () => {
  test('disabled (default): long silence with queued messages never force-finishes', async () => {
    configure(false)
    startTurn()
    await advance(40)
    expect(forceFinishCalls).toEqual([])
  })

  test('enabled but nothing queued: never force-finishes (long tools must survive)', async () => {
    configure(true)
    startTurn()
    await advance(40)
    expect(forceFinishCalls).toEqual([])
  })

  test('enabled + queued + silent ≥30min: force-finishes exactly once', async () => {
    configure(true)
    queued = true
    startTurn()
    await advance(29)
    expect(forceFinishCalls).toEqual([])
    await advance(2)
    expect(forceFinishCalls).toEqual([`${SESSION}:watchdog`])
    await advance(30)
    expect(forceFinishCalls).toEqual([`${SESSION}:watchdog`])
  })

  test('prompt diagnostic state carries no heartbeat veto field (N2: dead cross-process signal removed)', () => {
    startTurn()
    const state = getPromptDiagnosticState(SESSION)
    expect(state).toBeDefined()
    // 心跳否决位曾被写成独立安全垫,但 recordPromptHeartbeat 在两处运行上下文都打不中
    // 状态表键(process 模式跨进程 / embedded 键不同),实际永不生效 —— 已删除。
    // 若未来重新引入,必须同时提供跨进程上报通道,否则此测试会提醒补上。
    expect(state).not.toHaveProperty('lastHeartbeatAt')
  })

  test('stream progress resets the silent window', async () => {
    configure(true)
    queued = true
    startTurn()
    await advance(29)
    recordPromptProgress(SESSION, 'message.chunk')
    await advance(29)
    expect(forceFinishCalls).toEqual([])
    await advance(2)
    expect(forceFinishCalls).toEqual([`${SESSION}:watchdog`])
  })

  test('silent threshold is clamped to the 30 minute floor', async () => {
    configure(true, 5 * MINUTE)
    queued = true
    startTurn()
    await advance(10)
    expect(forceFinishCalls).toEqual([])
    await advance(25)
    expect(forceFinishCalls).toEqual([`${SESSION}:watchdog`])
  })
})
