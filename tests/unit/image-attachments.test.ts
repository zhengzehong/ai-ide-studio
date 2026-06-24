import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import {
  appendHiddenAttachmentNote,
  loadStoredImagesForAcp,
  saveSessionImages,
  saveTaskImages,
} from '../../src/core/image-attachments.js'

const PNG_BASE64 = 'iVBORw0KGgo='

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-image-attachments-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('image attachment helpers', () => {
  test('saves session images under DATA_DIR/images/sessions and builds model-only path notes', async () => {
    const saved = await saveSessionImages({
      projectId: 'proj-1',
      sessionId: 'sess-1',
      messageId: 'msg-1',
      images: [{ data: PNG_BASE64, mimeType: 'image/png', name: 'screen shot.png' }],
    })

    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      mimeType: 'image/png',
      name: 'screen shot.png',
      order: 1,
      size: Buffer.from(PNG_BASE64, 'base64').length,
    })
    expect(saved[0].relativePath).toMatch(/^images\/sessions\/proj-1\/sess-1\/msg-1\/001-/)
    expect(saved[0].path).toBe(resolve(tmp, saved[0].relativePath))
    expect(saved[0].url).toBe(`/api/images/${saved[0].relativePath}`)
    expect(existsSync(saved[0].path)).toBe(true)
    expect(readFileSync(saved[0].path).toString('base64')).toBe(PNG_BASE64)

    const prompt = appendHiddenAttachmentNote('请审查截图', saved)
    expect(prompt).toContain('请审查截图')
    expect(prompt).toContain('[附件说明]')
    expect(prompt).toContain(saved[0].path)
    expect(prompt).toContain('screen shot.png')
  })

  test('saves task images under DATA_DIR/images/tasks and reloads image blocks for ACP', async () => {
    const saved = await saveTaskImages({
      projectId: 'proj-2',
      taskId: 'task-1',
      images: [{ data: PNG_BASE64, mimeType: 'image/png', name: 'task.png' }],
    })

    expect(saved[0].relativePath).toMatch(/^images\/tasks\/proj-2\/task-1\/001-/)
    const blocks = await loadStoredImagesForAcp(saved)
    expect(blocks).toEqual([{ data: PNG_BASE64, mimeType: 'image/png', name: 'task.png' }])
  })
})
