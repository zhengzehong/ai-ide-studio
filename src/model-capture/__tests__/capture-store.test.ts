import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assembleSse,
  beginCapture,
  captureRoot,
  cleanupExpiredCaptures,
  recoverPendingCaptures,
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
  test('未完成 .tmp 补 proxy_restart 终态并 rename', () => {
    const root = captureRoot(tmp)
    const sessionDir = join(root, '2026-09-10', 'sess-xyz')
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

    const recovered = recoverPendingCaptures(root)
    expect(recovered).toBe(1)
    expect(existsSync(tmpFile)).toBe(false)
    const finalFile = tmpFile.replace(/\.tmp$/, '')
    const record = JSON.parse(readFileSync(finalFile, 'utf8'))
    expect(record.terminalStatus).toBe('proxy_restart')
    expect(record.response.sse).toEqual(['data: 1\n'])
  })

  test('损坏的 tmp 保留原样不崩溃', () => {
    const root = captureRoot(tmp)
    const sessionDir = join(root, '2026-09-10', '_unattributed')
    mkdirSync(sessionDir, { recursive: true })
    const tmpFile = join(sessionDir, '101010-0002-other.json.tmp')
    writeFileSync(tmpFile, '{broken json', 'utf8')
    expect(recoverPendingCaptures(root)).toBe(0)
    expect(existsSync(tmpFile)).toBe(true)
  })
})

describe('cleanupExpiredCaptures(保留天数)', () => {
  test('过期整天目录删除,当日保留,_unattributed 不受影响', () => {
    const root = captureRoot(tmp)
    const oldDay = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    mkdirSync(join(root, oldDay, 'sess-old'), { recursive: true })
    mkdirSync(join(root, '2020-01-01', '_unattributed'), { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    mkdirSync(join(root, today, 'sess-new'), { recursive: true })

    const removed = cleanupExpiredCaptures(root, 7)
    expect(removed).toBe(2)
    expect(existsSync(join(root, oldDay))).toBe(false)
    expect(existsSync(join(root, '2020-01-01'))).toBe(false)
    expect(existsSync(join(root, today, 'sess-new'))).toBe(true)
  })

  test('retention=0 边界:今天以外的都清', () => {
    const root = captureRoot(tmp)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    mkdirSync(join(root, yesterday, 'sess-y'), { recursive: true })
    expect(cleanupExpiredCaptures(root, 1)).toBe(1)
  })
})

describe('assembleSse', () => {
  test('claude 文本重组 + usage', () => {
    const { text, usage } = assembleSse([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" World"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":2}}\n\n',
    ])
    expect(text).toBe('Hello World')
    expect(usage).toMatchObject({ input_tokens: 10, output_tokens: 2 })
  })

  test('codex output_text.delta 重组', () => {
    const { text } = assembleSse([
      'data: {"type":"response.output_text.delta","delta":"codex-"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"text"}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(text).toBe('codex-text')
  })

  test('非 JSON data 行忽略不抛错', () => {
    const { text } = assembleSse(['data: not-json\n\n', ': keep-alive\n\n'])
    expect(text).toBe('')
  })
})
