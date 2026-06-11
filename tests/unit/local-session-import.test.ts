import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  listLocalSessionCandidates,
  parseLocalSessionFile,
  validateLocalSessionRuntime,
} from '../../src/core/local-session-import.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-local-session-import-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('local session import parser', () => {
  test('parses Codex session_meta payload id from a rollout jsonl', () => {
    const file = join(tmp, 'rollout-2026-06-11T01-02-03-019codex.jsonl')
    writeFileSync(file, [
      JSON.stringify({
        timestamp: '2026-06-11T01:02:03.000Z',
        type: 'session_meta',
        payload: { id: '019codex-session', cwd: '/repo/project' },
      }),
      JSON.stringify({ type: 'response_item', payload: { item: { type: 'message' } } }),
    ].join('\n'), 'utf-8')

    expect(parseLocalSessionFile(file)).toMatchObject({
      runtime: 'codex',
      sessionId: '019codex-session',
      cwd: '/repo/project',
      path: file,
    })
  })

  test('parses Claude sessionId from a session jsonl line', () => {
    const file = join(tmp, 'f4f82d42-6954-4723-9cab-7e97d0c6068d.jsonl')
    writeFileSync(file, [
      JSON.stringify({
        type: 'system',
        sessionId: 'f4f82d42-6954-4723-9cab-7e97d0c6068d',
        cwd: 'D:/repo/project',
      }),
    ].join('\n'), 'utf-8')

    expect(parseLocalSessionFile(file)).toMatchObject({
      runtime: 'claude',
      sessionId: 'f4f82d42-6954-4723-9cab-7e97d0c6068d',
      cwd: 'D:/repo/project',
    })
  })

  test('falls back to Claude filename UUID when sessionId is missing', () => {
    const file = join(tmp, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl')
    writeFileSync(file, JSON.stringify({ type: 'user', cwd: '/repo/project' }), 'utf-8')

    expect(parseLocalSessionFile(file)).toMatchObject({
      runtime: 'claude',
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      cwd: '/repo/project',
    })
  })

  test('only inspects the first bounded non-empty JSONL lines', () => {
    const file = join(tmp, 'rollout-2026-06-11T01-02-03-019late.jsonl')
    const ignoredPrefix = Array.from({ length: 20 }, (_, index) => JSON.stringify({ type: 'noise', index }))
    writeFileSync(file, [
      '',
      ...ignoredPrefix,
      JSON.stringify({ type: 'session_meta', payload: { id: '019too-late', cwd: '/repo/project' } }),
    ].join('\n'), 'utf-8')

    expect(() => parseLocalSessionFile(file)).toThrow('无法识别')
  })

  test('rejects runtime mismatches before importing', () => {
    const parsed = {
      runtime: 'codex' as const,
      sessionId: '019codex-session',
      path: join(tmp, 'rollout.jsonl'),
      label: 'Codex 019codex-session',
      updatedAt: '2026-06-11T01:02:03.000Z',
    }

    expect(() => validateLocalSessionRuntime(parsed, 'claude')).toThrow('runtime')
  })
})

describe('local session import candidate scanner', () => {
  test('lists recent Codex candidates from a bounded home directory', () => {
    const codexHome = join(tmp, '.codex')
    const firstDir = join(codexHome, 'sessions', '2026', '06', '10')
    const secondDir = join(codexHome, 'sessions', '2026', '06', '11')
    mkdirSync(firstDir, { recursive: true })
    mkdirSync(secondDir, { recursive: true })
    const older = join(firstDir, 'rollout-2026-06-10T01-00-00-019older.jsonl')
    const newer = join(secondDir, 'rollout-2026-06-11T01-00-00-019newer.jsonl')
    writeFileSync(older, JSON.stringify({ type: 'session_meta', payload: { id: '019older', cwd: '/repo/old' } }), 'utf-8')
    writeFileSync(newer, JSON.stringify({ type: 'session_meta', payload: { id: '019newer', cwd: '/repo/new' } }), 'utf-8')

    const candidates = listLocalSessionCandidates({ runtime: 'codex', codexHome, limit: 1 })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ runtime: 'codex', sessionId: '019newer', cwd: '/repo/new' })
  })

  test('lists Claude candidates from the encoded project directory first', () => {
    const claudeHome = join(tmp, '.claude')
    const encodedProject = 'D--repo-project'
    const projectDir = join(claudeHome, 'projects', encodedProject)
    const otherDir = join(claudeHome, 'projects', 'D--repo-other')
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(otherDir, { recursive: true })
    writeFileSync(
      join(projectDir, '11111111-1111-4111-8111-111111111111.jsonl'),
      JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111', cwd: 'D:/repo/project' }),
      'utf-8',
    )
    writeFileSync(
      join(otherDir, '22222222-2222-4222-8222-222222222222.jsonl'),
      JSON.stringify({ sessionId: '22222222-2222-4222-8222-222222222222', cwd: 'D:/repo/other' }),
      'utf-8',
    )

    const candidates = listLocalSessionCandidates({
      runtime: 'claude',
      claudeHome,
      cwd: 'D:/repo/project',
      limit: 10,
    })

    expect(candidates.map((candidate) => candidate.sessionId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
  })
})
