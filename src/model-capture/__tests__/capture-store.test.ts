import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assembleSse,
  beginCapture,
  captureCleanupPending,
  captureRoot,
  cleanupExpiredCaptures,
  enforceSessionFileLimit,
  parseCaptureMaxTotalBytes,
  recoverPendingCaptures,
  resetCaptureCleanupProgress,
  waitCaptureFlush,
} from '../capture-store.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-store-'))
})

afterEach(async () => {
  await waitCaptureFlush()
  rmSync(tmp, { recursive: true, force: true })
})

describe('beginCapture → finalize(tmp→rename)', () => {
  test('落盘目录结构与文件内容完整', async () => {
    const root = captureRoot(tmp)
    const writer = beginCapture(root, {
      kind: 'messages',
      platform: { sessionId: 'sess-abc123', agentId: 'agent-1', runtime: 'claude', sessionTitle: '测试会话' },
      model: 'glm-5.3-flash-1',
      provider: '测试供应商',
      requestHeaders: { 'content-type': 'application/json', 'x-api-key': 'sk-1***ef' },
      request: { model: 'glm-5.3-flash-1', messages: [] },
    })
    expect(writer.tmpPath.endsWith('.json.tmp')).toBe(true)
    expect(existsSync(writer.tmpPath)).toBe(false) // 首次 flush 前 tmp 未写

    writer.appendResponseChunk('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n')
    writer.appendResponseChunk('data: {"type":"message_delta","delta":{},"usage":{"input_tokens":73999,"output_tokens":516}}\n\n')
    writer.setStatus(200)
    writer.setError('流中段出现一次可恢复的写错误,应保留在终态记录里')
    await writer.finalize('completed')
    await waitCaptureFlush()

    expect(existsSync(writer.tmpPath)).toBe(false)
    expect(existsSync(writer.finalPath)).toBe(true)
    // 目录:<day>/sess-abc123/<HHmmss>-<seq>-messages.json
    const rootDir = readdirSync(root)
    expect(rootDir).toHaveLength(1)
    const sessionDir = readdirSync(join(root, rootDir[0]))
    expect(sessionDir).toEqual(['sess-abc123'])
    const file = readdirSync(join(root, rootDir[0], 'sess-abc123'))[0]
    expect(file).toMatch(/^\d{6}-\d{4}-messages\.json$/)

    const record = JSON.parse(readFileSync(writer.finalPath, 'utf8'))
    expect(record.terminalStatus).toBe('completed')
    expect(record.status).toBe(200)
    expect(record.error).toBe('流中段出现一次可恢复的写错误,应保留在终态记录里')
    expect(record.response.text).toBe('你好')
    expect(record.response.usage).toMatchObject({ input_tokens: 73999, output_tokens: 516 })
    expect(record.platform).toMatchObject({ sessionId: 'sess-abc123', agentId: 'agent-1', runtime: 'claude' })
    expect(record.ts).toBeTruthy()
    expect(record.finishedAt).toBeTruthy()
  })

  test('无会话标识落 _unattributed', async () => {
    const root = captureRoot(tmp)
    const writer = beginCapture(root, {
      kind: 'other',
      platform: { agentId: 'agent-1', runtime: 'claude' },
      requestHeaders: {},
      request: null,
    })
    await writer.finalize('completed')
    const dayDir = readdirSync(root)[0]
    expect(readdirSync(join(root, dayDir))).toEqual(['_unattributed'])
  })

  test('终态后迟到的 chunk 被丢弃,不再写盘', async () => {
    const root = captureRoot(tmp)
    const writer = beginCapture(root, {
      kind: 'messages',
      platform: { agentId: 'agent-1', runtime: 'claude' },
      requestHeaders: {},
      request: {},
    })
    await writer.finalize('completed')
    writer.appendResponseChunk('late data')
    const record = JSON.parse(readFileSync(writer.finalPath, 'utf8'))
    expect(record.response.sse).toHaveLength(0)
  })
})

describe('recoverPendingCaptures(proxy_restart 补落盘)', () => {
  test('未完成 .tmp 补 proxy_restart 终态并 rename', async () => {
    const root = captureRoot(tmp)
    const today = new Date().toISOString().slice(0, 10)
    const sessionDir = join(root, today, 'sess-xyz')
    mkdirSync(sessionDir, { recursive: true })
    const tmpFile = join(sessionDir, '101010-0001-messages.json.tmp')
    writeFileSync(tmpFile, JSON.stringify({
      ts: '2026-09-10T10:10:10.000Z',
      kind: 'messages',
      platform: { agentId: 'agent-1', runtime: 'claude' },
      requestHeaders: {},
      request: { model: 'm' },
      response: { sse: ['data: 1\n'], text: '' },
    }), 'utf8')

    const recovered = await recoverPendingCaptures(root)
    expect(recovered).toBe(1)
    expect(existsSync(tmpFile)).toBe(false)
    const finalFile = tmpFile.replace(/\.tmp$/, '')
    const record = JSON.parse(readFileSync(finalFile, 'utf8'))
    expect(record.terminalStatus).toBe('proxy_restart')
    expect(record.response.sse).toEqual(['data: 1\n'])
  })

  test('损坏的 tmp 保留原样不崩溃', async () => {
    const root = captureRoot(tmp)
    const today = new Date().toISOString().slice(0, 10)
    const sessionDir = join(root, today, '_unattributed')
    mkdirSync(sessionDir, { recursive: true })
    const tmpFile = join(sessionDir, '101010-0002-other.json.tmp')
    writeFileSync(tmpFile, '{broken json', 'utf8')
    expect(await recoverPendingCaptures(root)).toBe(0)
    expect(existsSync(tmpFile)).toBe(true)
  })

  test('只扫最近 2 天:更早的 .tmp 不再自动补终态', async () => {
    const root = captureRoot(tmp)
    const oldDay = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const sessionDir = join(root, oldDay, 'sess-ancient')
    mkdirSync(sessionDir, { recursive: true })
    const tmpFile = join(sessionDir, '101010-0003-messages.json.tmp')
    writeFileSync(tmpFile, JSON.stringify({
      ts: '2026-09-01T10:10:10.000Z',
      kind: 'messages',
      platform: { agentId: 'agent-1', runtime: 'claude' },
      requestHeaders: {},
      request: {},
      response: { sse: [], text: '' },
    }), 'utf8')

    expect(await recoverPendingCaptures(root)).toBe(0)
    // 原样保留,供人工检查
    expect(existsSync(tmpFile)).toBe(true)
  })
})

describe('cleanupExpiredCaptures(保留天数)', () => {
  test('过期整天目录删除,当日保留,_unattributed 不受影响', async () => {
    const root = captureRoot(tmp)
    const oldDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    mkdirSync(join(root, oldDay, 'sess-old'), { recursive: true })
    mkdirSync(join(root, '2020-01-01', '_unattributed'), { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    mkdirSync(join(root, today, 'sess-new'), { recursive: true })

    const removed = await cleanupExpiredCaptures(root, 7)
    expect(removed).toBe(2)
    expect(existsSync(join(root, oldDay))).toBe(false)
    expect(existsSync(join(root, '2020-01-01'))).toBe(false)
    expect(existsSync(join(root, today, 'sess-new'))).toBe(true)
  })

  test('retention=0 边界:今天以外的都清', async () => {
    const root = captureRoot(tmp)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    mkdirSync(join(root, yesterday, 'sess-y'), { recursive: true })
    expect(await cleanupExpiredCaptures(root, 1)).toBe(1)
  })
})

describe('assembleSse', () => {
  test('claude 文本重组 + usage', async () => {
    const { text, usage } = assembleSse([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" World"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":2}}\n\n',
    ])
    expect(text).toBe('Hello World')
    expect(usage).toMatchObject({ input_tokens: 10, output_tokens: 2 })
  })

  test('codex output_text.delta 重组', async () => {
    const { text } = assembleSse([
      'data: {"type":"response.output_text.delta","delta":"codex-"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"text"}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(text).toBe('codex-text')
  })

  test('非 JSON data 行忽略不抛错', async () => {
    const { text } = assembleSse(['data: not-json\n\n', ': keep-alive\n\n'])
    expect(text).toBe('')
  })
})

describe('enforceSessionFileLimit(每会话保留最新 N 个)', () => {
  const sessDir = (root: string, name = 'sess-limit') => join(root, '2026-09-10', name)

  /** 造 count 个已 finalize 文件,文件名 HHmmss-seq 字典序=时间序;额外写若干 .tmp。 */
  function seedFiles(dir: string, count: number, tmpCount = 0): void {
    mkdirSync(dir, { recursive: true })
    for (let i = 1; i <= count; i += 1) {
      const hh = String(Math.floor(i / 3600)).padStart(2, '0')
      const mm = String(Math.floor((i % 3600) / 60)).padStart(2, '0')
      const ss = String(i % 60).padStart(2, '0')
      const seq = String(i).padStart(4, '0')
      writeFileSync(join(dir, `${hh}${mm}${ss}-${seq}-messages.json`), '{}', 'utf8')
    }
    for (let i = 1; i <= tmpCount; i += 1) {
      writeFileSync(join(dir, `000000-${String(9000 + i).padStart(4, '0')}-messages.json.tmp`), '{}', 'utf8')
    }
  }

  test('超出上限删最老:101 删 1,最老的先走', async () => {
    const dir = sessDir(tmp)
    seedFiles(dir, 101)
    expect(await enforceSessionFileLimit(dir, 100)).toBe(1)
    const left = readdirSync(dir).filter((n) => n.endsWith('.json'))
    expect(left).toHaveLength(100)
    expect(left.some((n) => n.includes('-0001-'))).toBe(false) // 最老已删
    expect(left.some((n) => n.includes('-0101-'))).toBe(true) // 最新保留
  })

  test('正好 100 不删', async () => {
    const dir = sessDir(tmp)
    seedFiles(dir, 100)
    expect(await enforceSessionFileLimit(dir, 100)).toBe(0)
    expect(readdirSync(dir)).toHaveLength(100)
  })

  test('count_tokens/探测不占额度:100 个 messages + 50 个 count_tokens 一个不删', async () => {
    const dir = sessDir(tmp)
    seedFiles(dir, 100)
    for (let i = 1; i <= 50; i += 1) {
      writeFileSync(join(dir, `0000${String(i).padStart(2, '0')}-${String(2000 + i).padStart(4, '0')}-count_tokens.json`), '{}', 'utf8')
    }
    expect(await enforceSessionFileLimit(dir, 100)).toBe(0)
    const names = readdirSync(dir)
    expect(names.filter((n) => n.endsWith('-messages.json'))).toHaveLength(100)
    expect(names.filter((n) => n.endsWith('-count_tokens.json'))).toHaveLength(50)
  })

  test('probe 不占额度:100 个 messages + 50 个 probe 共存一个不删', async () => {
    const dir = sessDir(tmp)
    seedFiles(dir, 100)
    for (let i = 1; i <= 50; i += 1) {
      writeFileSync(join(dir, `0000${String(i).padStart(2, '0')}-${String(2000 + i).padStart(4, '0')}-probe.json`), '{}', 'utf8')
    }
    expect(await enforceSessionFileLimit(dir, 100)).toBe(0)
    const names = readdirSync(dir)
    expect(names.filter((n) => n.endsWith('-messages.json'))).toHaveLength(100)
    expect(names.filter((n) => n.endsWith('-probe.json'))).toHaveLength(50)
  })

  test('超限只删计数类最老:count_tokens 全部保留', async () => {
    const dir = sessDir(tmp)
    seedFiles(dir, 3) // messages ×3
    writeFileSync(join(dir, '000000-9001-count_tokens.json'), '{}', 'utf8')
    writeFileSync(join(dir, '000000-9002-other.json'), '{}', 'utf8')
    expect(await enforceSessionFileLimit(dir, 2)).toBe(1)
    const names = readdirSync(dir)
    expect(names.filter((n) => n.endsWith('-messages.json'))).toHaveLength(2)
    expect(names.some((n) => n.endsWith('-count_tokens.json'))).toBe(true)
    expect(names.some((n) => n.endsWith('-other.json'))).toBe(true)
    expect(names.some((n) => n.includes('-0001-'))).toBe(false) // 删的是最老 messages
  })

  test('.tmp 不计入数量且绝不清理', async () => {
    const dir = sessDir(tmp)
    seedFiles(dir, 101, 3)
    expect(await enforceSessionFileLimit(dir, 100)).toBe(1)
    const names = readdirSync(dir)
    expect(names.filter((n) => n.endsWith('.json'))).toHaveLength(100)
    expect(names.filter((n) => n.endsWith('.json.tmp'))).toHaveLength(3) // 全部保留
  })

  test('_unattributed 同规则', async () => {
    const dir = sessDir(tmp, '_unattributed')
    seedFiles(dir, 5)
    expect(await enforceSessionFileLimit(dir, 3)).toBe(2)
    expect(readdirSync(dir).filter((n) => n.endsWith('.json'))).toHaveLength(3)
  })

  test('finalize 后自动触发清理(beginCapture 传 maxPerSession)', async () => {
    const root = captureRoot(tmp)
    const platform = { agentId: 'agent-1', runtime: 'claude' as const }
    for (let i = 0; i < 3; i += 1) {
      const writer = beginCapture(root, {
        kind: 'messages',
        platform,
        requestHeaders: {},
        request: { seq: i },
        maxPerSession: 2,
      })
      await writer.finalize('completed')
    }
    await waitCaptureFlush()
    const dayDir = readdirSync(root)[0]
    // platform 无 sessionId → 落 _unattributed,同样受 maxPerSession 约束
    const files = readdirSync(join(root, dayDir, '_unattributed')).filter((n) => n.endsWith('.json'))
    expect(files).toHaveLength(2)
  })

  test('目录不存在或上限非法:不抛错不删除', async () => {
    expect(await enforceSessionFileLimit(join(tmp, 'no-such-dir'), 100)).toBe(0)
    const dir = sessDir(tmp)
    seedFiles(dir, 5)
    expect(await enforceSessionFileLimit(dir, 0)).toBe(0)
    expect(readdirSync(dir).filter((n) => n.endsWith('.json'))).toHaveLength(5)
  })
})

describe('抓包清理分片 / 时间预算 / 总量上限(P0-4)', () => {
  test('时间预算用尽:保留剩余并标记续跑,下一轮删完', async () => {
    resetCaptureCleanupProgress()
    const root = captureRoot(tmp)
    const oldDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const dayDir = join(root, oldDay, 'sess-big')
    mkdirSync(dayDir, { recursive: true })
    for (let index = 0; index < 250; index += 1) {
      writeFileSync(join(dayDir, `1010${String(index).padStart(2, '0')}-0001-messages.json`), '{}', 'utf8')
    }

    // 预算 0ms + 每片 100 个文件 → 第一片之后即判定超预算
    const removedFirst = await cleanupExpiredCaptures(root, 7, { timeBudgetMs: 0, filesPerSlice: 100 })
    expect(removedFirst).toBe(0) // 整天目录尚未删完
    expect(existsSync(join(root, oldDay))).toBe(true)
    expect(captureCleanupPending()).toBe(true)
    const leftAfterFirst = readdirSync(dayDir).length
    expect(leftAfterFirst).toBe(150)

    // 下一轮给足预算 → 续跑并删完
    const removedSecond = await cleanupExpiredCaptures(root, 7, { timeBudgetMs: 30_000 })
    expect(removedSecond).toBe(1)
    expect(existsSync(join(root, oldDay))).toBe(false)
    expect(captureCleanupPending()).toBe(false)
  })

  test('批间让出事件循环:清理期间定时器仍能触发', async () => {
    resetCaptureCleanupProgress()
    const root = captureRoot(tmp)
    const oldDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const dayDir = join(root, oldDay, 'sess-yield')
    mkdirSync(dayDir, { recursive: true })
    for (let index = 0; index < 450; index += 1) {
      writeFileSync(join(dayDir, `1010${String(index).padStart(2, '0')}-0001-messages.json`), '{}', 'utf8')
    }

    let ticks = 0
    const timer = setInterval(() => { ticks += 1 }, 1)
    try {
      await cleanupExpiredCaptures(root, 7, { timeBudgetMs: 30_000, filesPerSlice: 100 })
    } finally {
      clearInterval(timer)
    }
    // 若删除是同步一口气做完,事件循环不会被让出,ticks 会是 0
    expect(ticks).toBeGreaterThan(0)
    expect(existsSync(join(root, oldDay))).toBe(false)
  })

  test('总量上限默认关闭;开启后从最老一天开始删到限额内', async () => {
    resetCaptureCleanupProgress()
    const root = captureRoot(tmp)
    const dayName = (offset: number): string =>
      new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const days = [dayName(3), dayName(2), dayName(1)]
    for (const day of days) {
      const dir = join(root, day, 'sess-x')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '101010-0001-messages.json'), 'x'.repeat(1000), 'utf8')
    }

    // 不传 maxTotalBytes → 只按保留期(30 天,都不算过期),一天都不删
    expect(await cleanupExpiredCaptures(root, 30)).toBe(0)
    expect(days.every((day) => existsSync(join(root, day)))).toBe(true)

    // 限额 1500B:3 天共 3000B → 从最老开始删,直到 <=1500
    const removed = await cleanupExpiredCaptures(root, 30, { maxTotalBytes: 1500 })
    expect(removed).toBe(2)
    expect(existsSync(join(root, days[0] as string))).toBe(false)
    expect(existsSync(join(root, days[1] as string))).toBe(false)
    expect(existsSync(join(root, days[2] as string))).toBe(true)
  })

  test('CAPTURE_MAX_TOTAL_BYTES 解析:缺省/非法/负数一律关闭', () => {
    expect(parseCaptureMaxTotalBytes(undefined)).toBeUndefined()
    expect(parseCaptureMaxTotalBytes('')).toBeUndefined()
    expect(parseCaptureMaxTotalBytes('abc')).toBeUndefined()
    expect(parseCaptureMaxTotalBytes('0')).toBeUndefined()
    expect(parseCaptureMaxTotalBytes('-1')).toBeUndefined()
    expect(parseCaptureMaxTotalBytes('8388608')).toBe(8388608)
  })
})