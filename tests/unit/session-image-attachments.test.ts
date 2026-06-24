import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acpHost } from '../../src/acp/host.js'
import { sessionManager } from '../../src/core/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'

const PNG_BASE64 = 'iVBORw0KGgo='

let tmp: string
let originalEnsureSession: typeof acpHost.ensureSession
let originalPrompt: typeof acpHost.prompt

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-image-attachments-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  originalEnsureSession = acpHost.ensureSession
  originalPrompt = acpHost.prompt
})

afterEach(() => {
  acpHost.ensureSession = originalEnsureSession
  acpHost.prompt = originalPrompt
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('session image attachments', () => {
  test('keeps human message text clean while sending model-only file paths and image blocks to ACP', async () => {
    const project = projectStore.create({ name: 'P', workDir: tmp })
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock', projectId: project.id })
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    let prompted: { content: string; images?: Array<{ data: string; mimeType: string; name?: string }> } | null = null

    acpHost.ensureSession = (async () => 'acp-session') as typeof acpHost.ensureSession
    acpHost.prompt = (async (_agentId, _sessionId, content, images) => {
      prompted = { content, images }
    }) as typeof acpHost.prompt

    await sessionManager.sendPrompt(
      session.id,
      '请把截图贴到报告里',
      [{ data: PNG_BASE64, mimeType: 'image/png', name: 'report.png' }],
      { clientMessageId: 'msg-human-image' },
    )

    const humanMessage = messageStore.get('msg-human-image')
    expect(humanMessage?.content).toBe('请把截图贴到报告里')
    expect(humanMessage?.content).not.toContain('[附件说明]')

    const attachments = JSON.parse(humanMessage?.attachments_json || '[]') as Array<{ data?: string; path: string; url: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0].data).toBeUndefined()
    expect(attachments[0].path).toContain(resolve(tmp, 'images', 'sessions', project.id, session.id, 'msg-human-image'))
    expect(attachments[0].url).toContain(`/api/images/images/sessions/${project.id}/`)
    expect(existsSync(attachments[0].path)).toBe(true)

    expect(prompted?.content).toContain('请把截图贴到报告里')
    expect(prompted?.content).toContain('[附件说明]')
    expect(prompted?.content).toContain(attachments[0].path)
    expect(prompted?.images).toEqual([{ data: PNG_BASE64, mimeType: 'image/png', name: 'report.png' }])
  })
})
