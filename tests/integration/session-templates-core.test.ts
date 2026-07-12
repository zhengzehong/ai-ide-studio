import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionTemplateStore } from '../../src/store/session-templates.js'
import { sessionStore } from '../../src/store/sessions.js'
import { agentStore } from '../../src/store/agents.js'
import { acpHost } from '../../src/acp/host.js'
import { sessionTemplateManager } from '../../src/core/session-templates.js'

let tmp = ''

function setupDb(): void {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-session-templates-core-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
}

function teardownDb(): void {
  closeDatabase()
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true })
    tmp = ''
  }
}

function makeAgent(runtime = 'claude'): string {
  const agent = agentStore.create({
    type: 'test',
    name: `tester-${Math.random().toString(36).slice(2, 6)}`,
    runtime,
  })
  return agent.id
}

function makeSession(agentId: string, opts: { acpSessionId?: string | null; isTemplate?: boolean; projectId?: string } = {}): string {
  const session = sessionStore.create({
    agentId,
    projectId: opts.projectId,
    acpSessionId: opts.acpSessionId ?? undefined,
    isTemplate: opts.isTemplate,
    title: 'src session',
  })
  return session.id
}

function mockForkSessionFromAcpSessionId(returnId: string, capture?: { params?: unknown }) {
  const spy = vi.spyOn(acpHost, 'forkSessionFromAcpSessionId').mockImplementation(
    async (agentId: string, sourceAcpSessionId: string, targetSessionId: string) => {
      if (capture) capture.params = { agentId, sourceAcpSessionId, targetSessionId }
      sessionStore.updateAcpSessionId(targetSessionId, returnId)
      return returnId
    },
  )
  return spy
}

function mockCloseSession() {
  return vi.spyOn(acpHost, 'closeSession').mockResolvedValue(undefined)
}

describe('sessionTemplateManager', () => {
  beforeEach(() => {
    setupDb()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    teardownDb()
  })

  describe('publishSessionAsTemplate', () => {
    it('成功路径:源会话 → 模板记录 + 模板会话 is_template=1', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })

      const forkCapture: { params?: unknown } = {}
      const forkSpy = mockForkSessionFromAcpSessionId('acp-tpl-new', forkCapture)
      const closeSpy = mockCloseSession()

      const template = await sessionTemplateManager.publishSessionAsTemplate({
        sourceSessionId,
        name: '我的模板',
        description: 'desc',
        icon: 'bot',
      })

      expect(template.id.startsWith('tpl-sess-')).toBe(true)
      expect(template.name).toBe('我的模板')
      expect(template.description).toBe('desc')
      expect(template.icon).toBe('bot')
      expect(template.agent_id).toBe(agentId)
      expect(template.runtime).toBe('claude')
      expect(template.source_session_id).toBe(sourceSessionId)
      expect(template.use_count).toBe(0)
      expect(template.template_session_id).toBeTruthy()

      const templateSession = sessionStore.get(template.template_session_id)
      expect(templateSession).toBeDefined()
      expect(templateSession?.is_template).toBe(1)
      expect(templateSession?.acp_session_id).toBe('acp-tpl-new')
      expect(templateSession?.title).toBe('我的模板')

      expect(forkSpy).toHaveBeenCalledTimes(1)
      expect(forkCapture.params).toMatchObject({
        agentId,
        sourceAcpSessionId: 'acp-src-1',
        targetSessionId: template.template_session_id,
      })
      expect(closeSpy).not.toHaveBeenCalled()
    })

    it('源会话是模板:throw "不能把模板会话发布为模板"', async () => {
      const agentId = makeAgent('claude')
      const tplSessionId = makeSession(agentId, { acpSessionId: 'acp-1', isTemplate: true })

      const forkSpy = mockForkSessionFromAcpSessionId('acp-tpl-new')
      const closeSpy = mockCloseSession()

      await expect(
        sessionTemplateManager.publishSessionAsTemplate({
          sourceSessionId: tplSessionId,
          name: 't',
        }),
      ).rejects.toThrow('不能把模板会话发布为模板')

      expect(forkSpy).not.toHaveBeenCalled()
      expect(closeSpy).not.toHaveBeenCalled()
    })

    it('源会话无 acp_session_id:throw "暂无可复制的上下文"', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: null })

      const forkSpy = mockForkSessionFromAcpSessionId('acp-tpl-new')
      const closeSpy = mockCloseSession()

      await expect(
        sessionTemplateManager.publishSessionAsTemplate({
          sourceSessionId,
          name: 't',
        }),
      ).rejects.toThrow('暂无可复制的上下文')

      expect(forkSpy).not.toHaveBeenCalled()
      expect(closeSpy).not.toHaveBeenCalled()
    })

    it('源会话不存在:throw "Session not found"', async () => {
      const forkSpy = mockForkSessionFromAcpSessionId('acp-tpl-new')
      await expect(
        sessionTemplateManager.publishSessionAsTemplate({
          sourceSessionId: 'sess-not-exist',
          name: 't',
        }),
      ).rejects.toThrow('Session not found')
      expect(forkSpy).not.toHaveBeenCalled()
    })

    it('fork 失败:throw + 清理 placeholder 模板会话', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })

      const forkSpy = vi.spyOn(acpHost, 'forkSessionFromAcpSessionId').mockRejectedValue(new Error('ACP fork 失败'))
      const closeSpy = mockCloseSession()

      await expect(
        sessionTemplateManager.publishSessionAsTemplate({
          sourceSessionId,
          name: 't',
        }),
      ).rejects.toThrow('发布模板失败:ACP fork 失败')

      expect(forkSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).toHaveBeenCalledTimes(1)
      const templates = sessionTemplateStore.list()
      expect(templates.length).toBe(0)
    })
  })

  describe('instantiateSessionTemplate', () => {
    it('成功路径:模板 → 新会话,新会话 is_template=0,use_count +1', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })
      const templateSessionId = makeSession(agentId, { acpSessionId: 'acp-tpl-1', isTemplate: true })

      const template = sessionTemplateStore.create({
        name: 'TPL',
        agentId,
        runtime: 'claude',
        sourceSessionId,
        templateSessionId,
      })

      const forkCapture: { params?: unknown } = {}
      const forkSpy = mockForkSessionFromAcpSessionId('acp-new-1', forkCapture)
      const closeSpy = mockCloseSession()

      const newSession = await sessionTemplateManager.instantiateSessionTemplate(template.id)

      expect(newSession.id.startsWith('sess-')).toBe(true)
      expect(newSession.is_template).toBe(0)
      expect(newSession.acp_session_id).toBe('acp-new-1')
      expect(newSession.agent_id).toBe(agentId)

      expect(forkSpy).toHaveBeenCalledTimes(1)
      expect(forkCapture.params).toMatchObject({
        agentId,
        sourceAcpSessionId: 'acp-tpl-1',
        targetSessionId: newSession.id,
      })
      expect(closeSpy).not.toHaveBeenCalled()

      const updatedTemplate = sessionTemplateStore.get(template.id)
      expect(updatedTemplate?.use_count).toBe(1)
      expect(updatedTemplate?.last_used_at).toBeTruthy()
    })

    it('模板不存在:throw "Template not found"', async () => {
      const forkSpy = mockForkSessionFromAcpSessionId('acp-new-1')
      await expect(
        sessionTemplateManager.instantiateSessionTemplate('tpl-sess-not-exist'),
      ).rejects.toThrow('Template not found')
      expect(forkSpy).not.toHaveBeenCalled()
    })

    it('模板会话无 acp_session_id:throw 明确错误', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })
      const templateSessionId = makeSession(agentId, { acpSessionId: null, isTemplate: true })

      const template = sessionTemplateStore.create({
        name: 'TPL',
        agentId,
        runtime: 'claude',
        sourceSessionId,
        templateSessionId,
      })

      const forkSpy = mockForkSessionFromAcpSessionId('acp-new-1')
      const closeSpy = mockCloseSession()

      await expect(
        sessionTemplateManager.instantiateSessionTemplate(template.id),
      ).rejects.toThrow('暂无可复制的上下文')

      expect(forkSpy).not.toHaveBeenCalled()
      expect(closeSpy).not.toHaveBeenCalled()
      const stillTemplate = sessionTemplateStore.get(template.id)
      expect(stillTemplate?.use_count).toBe(0)
    })

    it('模板会话已删除:throw "模板会话不存在"', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })
      const templateSessionId = makeSession(agentId, { acpSessionId: 'acp-tpl-1', isTemplate: true })

      const template = sessionTemplateStore.create({
        name: 'TPL',
        agentId,
        runtime: 'claude',
        sourceSessionId,
        templateSessionId,
      })

      sessionStore.delete(templateSessionId)

      const forkSpy = mockForkSessionFromAcpSessionId('acp-new-1')

      await expect(
        sessionTemplateManager.instantiateSessionTemplate(template.id),
      ).rejects.toThrow('模板会话不存在或已被删除')

      expect(forkSpy).not.toHaveBeenCalled()
    })

    it('fork 失败:throw + 清理 placeholder 新会话,use_count 不增', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })
      const templateSessionId = makeSession(agentId, { acpSessionId: 'acp-tpl-1', isTemplate: true })

      const template = sessionTemplateStore.create({
        name: 'TPL',
        agentId,
        runtime: 'claude',
        sourceSessionId,
        templateSessionId,
      })

      const forkSpy = vi.spyOn(acpHost, 'forkSessionFromAcpSessionId').mockRejectedValue(new Error('ACP fork 失败'))
      const closeSpy = mockCloseSession()

      await expect(
        sessionTemplateManager.instantiateSessionTemplate(template.id),
      ).rejects.toThrow('从模板新建失败:ACP fork 失败')

      expect(forkSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).toHaveBeenCalledTimes(1)
      const updatedTemplate = sessionTemplateStore.get(template.id)
      expect(updatedTemplate?.use_count).toBe(0)
    })
  })

  describe('deleteTemplate', () => {
    it('模板记录删 + 模板会话关闭删除', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })
      const templateSessionId = makeSession(agentId, { acpSessionId: 'acp-tpl-1', isTemplate: true })

      const template = sessionTemplateStore.create({
        name: 'TPL',
        agentId,
        runtime: 'claude',
        sourceSessionId,
        templateSessionId,
      })

      const closeSpy = mockCloseSession()

      await sessionTemplateManager.deleteTemplate(template.id)

      expect(closeSpy).toHaveBeenCalledWith(agentId, templateSessionId)
      expect(sessionTemplateStore.get(template.id)).toBeUndefined()
      const templateSession = sessionStore.get(templateSessionId)
      expect(templateSession?.deleted_at).toBeTruthy()
    })

    it('模板不存在:静默返回,不抛错', async () => {
      const closeSpy = mockCloseSession()
      await expect(
        sessionTemplateManager.deleteTemplate('tpl-sess-not-exist'),
      ).resolves.toBeUndefined()
      expect(closeSpy).not.toHaveBeenCalled()
    })

    it('模板会话已删除:只删模板记录,不抛错', async () => {
      const agentId = makeAgent('claude')
      const sourceSessionId = makeSession(agentId, { acpSessionId: 'acp-src-1' })
      const templateSessionId = makeSession(agentId, { acpSessionId: 'acp-tpl-1', isTemplate: true })

      const template = sessionTemplateStore.create({
        name: 'TPL',
        agentId,
        runtime: 'claude',
        sourceSessionId,
        templateSessionId,
      })

      sessionStore.delete(templateSessionId)

      const closeSpy = mockCloseSession()

      await sessionTemplateManager.deleteTemplate(template.id)

      expect(sessionTemplateStore.get(template.id)).toBeUndefined()
      expect(closeSpy).toHaveBeenCalledWith(agentId, templateSessionId)
    })
  })
})
