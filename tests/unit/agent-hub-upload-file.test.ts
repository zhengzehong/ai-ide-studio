import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentHubService } from '../../src/core/agent-hub/index.js'
import { hubClient } from '../../src/core/agent-hub/hub-client.js'
import { resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'
import type { ToolHandlerResult } from '../../src/tools/types.js'
import { getHandler } from '../../src/tools/handlers/index.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-hub-upload-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  resetCachedMachineIdForTest()
  process.env.AGENT_HUB_ENABLED = 'true'
  process.env.AGENT_HUB_URL = 'http://hub.test'
  process.env.AGENT_HUB_PROVIDER_TOKEN = 'provider-token'
  process.env.AGENT_HUB_CALLER_TOKEN = 'caller-token'
  process.env.AGENT_HUB_INTERNAL_TOKEN = 'internal-token'
})

afterEach(() => {
  agentHubService._resetForTest()
  resetCachedMachineIdForTest()
  delete process.env.AGENT_HUB_ENABLED
  delete process.env.AGENT_HUB_URL
  delete process.env.AGENT_HUB_PROVIDER_TOKEN
  delete process.env.AGENT_HUB_CALLER_TOKEN
  delete process.env.AGENT_HUB_INTERNAL_TOKEN
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

async function connectSession(): Promise<{ sessionId: string; agentId: string }> {
  const agent = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock' })
  const session = sessionStore.create({ agentId: agent.id })
  vi.spyOn(hubClient, 'register').mockResolvedValue({
    registrationId: 'reg-1',
    agents: [{ localAgentId: agent.id, hubAgentId: 'h-me' }],
    reused: false,
  })
  vi.spyOn(hubClient, 'search').mockResolvedValue([
    { hubAgentId: 'h-other', name: 'B Agent' },
  ])
  await agentHubService.connect(session.id, agent.id, undefined)
  return { sessionId: session.id, agentId: agent.id }
}

describe('agent_hub.upload_file 工具', () => {
  test('未连接时返回 isError', async () => {
    const session = sessionStore.create({ agentId: 'agent-x' })
    const handler = getHandler('agent_hub.upload_file')!
    const result: ToolHandlerResult = await handler.execute(
      { filePath: '/tmp/x.txt' },
      { sessionId: session.id },
    )
    expect(result.isError).toBe(true)
  })

  test('上传成功返回引导文本,包含 url', async () => {
    const { sessionId } = await connectSession()
    const filePath = resolve(tmp, 'note.txt')
    writeFileSync(filePath, 'hello world')

    const uploadSpy = vi.spyOn(hubClient, 'uploadFile').mockResolvedValue({
      fileId: 'file-abc',
      filename: 'note.txt',
      mediaType: 'text/plain',
      size: 11,
      url: 'http://hub.test/hub/v1/files/file-abc/download',
    })

    const handler = getHandler('agent_hub.upload_file')!
    const result: ToolHandlerResult = await handler.execute(
      { filePath, purpose: 'review' },
      { sessionId },
    )
    expect(result.isError).not.toBe(true)
    const text = result.content[0].text
    expect(text).toContain('http://hub.test/hub/v1/files/file-abc/download')
    expect(text).toContain('note.txt')
    expect(text).toContain('text/plain')
    expect(text).toContain('11')
    expect(text).toContain('请在你的回复消息中直接写入上面的 url')
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(uploadSpy.mock.calls[0][2]).toBe(filePath)
    expect(uploadSpy.mock.calls[0][3]).toBe('review')
  })

  test('文件不存在时返回 isError', async () => {
    const { sessionId } = await connectSession()
    vi.spyOn(hubClient, 'uploadFile').mockRejectedValue(
      Object.assign(new Error('ENOENT'), { status: 0 }),
    )
    const handler = getHandler('agent_hub.upload_file')!
    const result: ToolHandlerResult = await handler.execute(
      { filePath: resolve(tmp, 'missing.txt') },
      { sessionId },
    )
    expect(result.isError).toBe(true)
  })

  test('工具已注册到 handler map', () => {
    expect(getHandler('agent_hub.upload_file')).toBeDefined()
  })
})
