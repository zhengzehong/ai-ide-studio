import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import {
  SessionFileUploadError,
  saveSessionFile,
} from '../../src/core/session-file-attachments.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-file-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session file attachments', () => {
  test('streams a file into the scoped attachment directory', async () => {
    const saved = await saveSessionFile({
      projectId: 'proj-1',
      sessionId: 'sess-1',
      fileName: 'requirements final.pdf',
      mimeType: 'application/pdf',
      body: byteStream('pdf-content'),
      contentLength: 11,
    })

    expect(saved).toMatchObject({
      name: 'requirements final.pdf',
      mimeType: 'application/pdf',
      size: 11,
    })
    expect(saved.relativePath).toMatch(
      /^attachments\/sessions\/proj-1\/sess-1\/[a-f0-9-]+\/requirements final\.pdf$/,
    )
    expect(saved.path).toBe(resolve(tmp, saved.relativePath))
    expect(readFileSync(saved.path, 'utf8')).toBe('pdf-content')
  })

  test.each(['../secret.txt', 'folder/file.txt', 'folder\\file.txt', 'bad:name.txt', 'CON.txt', 'trailing.', '']) (
    'rejects an unsafe filename: %j',
    async (fileName) => {
      await expect(saveSessionFile({
        projectId: 'proj-1',
        sessionId: 'sess-1',
        fileName,
        mimeType: 'text/plain',
        body: byteStream('x'),
        contentLength: 1,
      })).rejects.toBeInstanceOf(SessionFileUploadError)
    },
  )

  test('rejects an oversized stream and removes the partial upload', async () => {
    await expect(saveSessionFile({
      projectId: 'proj-1',
      sessionId: 'sess-1',
      fileName: 'large.bin',
      mimeType: 'application/octet-stream',
      body: byteStream('123456'),
      maxBytes: 5,
    })).rejects.toMatchObject({ status: 413 })

    const sessionDirectory = resolve(tmp, 'attachments', 'sessions', 'proj-1', 'sess-1')
    expect(existsSync(sessionDirectory)).toBe(true)
    expect(readdirSync(sessionDirectory)).toEqual([])
  })
})

function byteStream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}
