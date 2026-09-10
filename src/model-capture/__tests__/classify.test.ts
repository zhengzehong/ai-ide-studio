import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase, closeDatabase } from '../../store/db.js'
import { sessionStore } from '../../store/sessions.js'
import { agentStore } from '../../store/agents.js'
import {
  detectCaptureKind,
  extractCaptureIdentity,
  lookupSessionByAcpUuid,
  maskSecret,
  maskSensitiveHeaders,
} from '../classify.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-classify-'))
  initDatabase(join(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('extractCaptureIdentity', () => {
  test('claude:metadata.user_id 末段 UUID', () => {
    const identity = extractCaptureIdentity({
      metadata: { user_id: 'user_9f2c_account__session_402b418e-4c4b-4014-8370-7b3f4bcfb299' },
    })
    expect(identity.runtimeHint).toBe('claude')
    expect(identity.sessionUuid).toBe('402b418e-4c4b-4014-8370-7b3f4bcfb299')
  })

  test('claude:user_id 含多个 UUID 时取末段', () => {
    const identity = extractCaptureIdentity({
      metadata: { user_id: 'aaaa-bbbb-cccc-dddd-eeee-ffff-0000 user_1_11111111-2222-3333-4444-555555555555' },
    })
    expect(identity.sessionUuid).toBe('11111111-2222-3333-4444-555555555555')
  })

  test('codex:client_metadata.session_id 优先', () => {
    const identity = extractCaptureIdentity({
      client_metadata: {
        session_id: '01a08973-cbe7-4c1e-9f2a-3b4c5d6e7f80',
        thread_id: 'other-uuid',
        turn_id: 'turn-1',
      },
    })
    expect(identity.runtimeHint).toBe('codex')
    expect(identity.sessionUuid).toBe('01a08973-cbe7-4c1e-9f2a-3b4c5d6e7f80')
    expect(identity.turnId).toBe('turn-1')
  })

  test('codex:session_id 缺失时回落 thread_id / prompt_cache_key', () => {
    const byThread = extractCaptureIdentity({
      client_metadata: { thread_id: '22222222-3333-4444-5555-666666666666' },
    })
    expect(byThread.sessionUuid).toBe('22222222-3333-4444-5555-666666666666')
    const byCacheKey = extractCaptureIdentity({
      client_metadata: { prompt_cache_key: '33333333-4444-5555-6666-777777777777' },
    })
    expect(byCacheKey.sessionUuid).toBe('33333333-4444-5555-6666-777777777777')
  })

  test('无标识体返回 unknown', () => {
    expect(extractCaptureIdentity({ model: 'x' }).runtimeHint).toBe('unknown')
    expect(extractCaptureIdentity(null).runtimeHint).toBe('unknown')
    expect(extractCaptureIdentity('not-object').runtimeHint).toBe('unknown')
  })
})

describe('lookupSessionByAcpUuid', () => {
  test('命中反查并返回 id/title/agentId', () => {
    const agent = agentStore.create({ name: '归因', type: 'dev', runtime: 'claude' })
    const session = sessionStore.create({
      agentId: agent.id,
      title: '归因会话',
      acpSessionId: '402b418e-4c4b-4014-8370-7b3f4bcfb299',
    })
    const info = lookupSessionByAcpUuid('402b418e-4c4b-4014-8370-7b3f4bcfb299')
    expect(info).toEqual({ sessionId: session.id, agentId: agent.id, sessionTitle: '归因会话' })
  })

  test('未命中返回 null', () => {
    expect(lookupSessionByAcpUuid('99999999-9999-9999-9999-999999999999')).toBeNull()
  })
})

describe('detectCaptureKind', () => {
  test('路径分型', () => {
    expect(detectCaptureKind('/v1/messages/count_tokens')).toBe('count_tokens')
    expect(detectCaptureKind('/v1/messages')).toBe('messages')
    expect(detectCaptureKind('/responses')).toBe('responses')
    expect(detectCaptureKind('/v1/complete')).toBe('other')
  })
})

describe('鉴权头打码', () => {
  test('maskSensitiveHeaders 打码敏感头,普通头保留', () => {
    const masked = maskSensitiveHeaders({
      'x-api-key': 'sk-ant-1234567890abcdef',
      Authorization: 'Bearer sk-abc12345678',
      'content-type': 'application/json',
      'anthropic-beta': 'prompt-caching',
    })
    expect(masked['x-api-key']).toMatch(/^\*?\*?\*?|sk-a/) // 打码而非原文
    expect(masked['x-api-key']).not.toBe('sk-ant-1234567890abcdef')
    expect(masked['authorization']).not.toContain('sk-abc12345678')
    expect(masked['content-type']).toBe('application/json')
    expect(masked['anthropic-beta']).toBe('prompt-caching')
  })

  test('maskSecret 边界', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret('short')).toBe('***')
    expect(maskSecret('sk-1234567890')).toBe('sk-1***7890')
  })
})
