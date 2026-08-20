import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { sessionStore, eventStore } from '../../src/store/sessions.js'
import { sessionManager } from '../../src/core/sessions.js'
import { acpHost } from '../../src/acp/host.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-prompt-lock-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('sessionManager prompt lifecycle', () => {
  test('同一 Local Session 的忙碌期间输入合并为一次下一轮 prompt', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    const gates = [deferred<void>(), deferred<void>()]
    const prompts: string[] = []

    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-existing') as typeof acpHost.ensureSession
    acpHost.prompt = (async (_agentId, _sessionId, content) => {
      prompts.push(content)
      const index = prompts.length - 1
      await gates[index]?.promise
    }) as typeof acpHost.prompt

    try {
      const first = sessionManager.sendPrompt(session.id, 'first')
      await waitUntil(() => prompts.length === 1)

      const user = sessionManager.sendPrompt(session.id, 'user follow-up')
      const agentMessage = sessionManager.enqueuePrompt(session.id, 'agent follow-up')
      const firstRule = sessionManager.enqueuePrompt(session.id, 'scheduled first', undefined, { dedupeKey: 'rule:daily' })
      const latestRule = sessionManager.enqueuePrompt(session.id, 'scheduled latest', undefined, { dedupeKey: 'rule:daily' })

      gates[0].resolve()
      await waitUntil(() => prompts.length === 2)

      expect(prompts).toEqual([
        'first',
        expect.stringContaining('user follow-up'),
      ])
      expect(prompts[1]).toContain('agent follow-up')
      expect(prompts[1]).toContain('scheduled latest')
      expect(prompts[1]).not.toContain('scheduled first')

      gates[1].resolve()
      await Promise.all([first, user, agentMessage, firstRule, latestRule])

      const userEvents = eventStore.list(session.id).filter(event => event.type === 'message.user')
      expect(userEvents).toHaveLength(4)
      expect(userEvents.map((event) => JSON.parse(event.payload_json).content)).toEqual([
        'first',
        'user follow-up',
        'agent follow-up',
        'scheduled latest',
      ])
    } finally {
      gates.forEach((gate) => gate.resolve())
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })

  test('批次开始后到达的新输入进入下一次 prompt', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const prompts: string[] = []
    const originalEnsureSession = acpHost.ensureSession
    const originalPrompt = acpHost.prompt
    acpHost.ensureSession = (async () => 'acp-existing') as typeof acpHost.ensureSession
    acpHost.prompt = (async (_agentId, _sessionId, content) => {
      prompts.push(content)
      await gates[prompts.length - 1]?.promise
    }) as typeof acpHost.prompt

    try {
      const first = sessionManager.sendPrompt(session.id, 'first')
      await waitUntil(() => prompts.length === 1)
      const second = sessionManager.enqueuePrompt(session.id, 'second')

      gates[0].resolve()
      await waitUntil(() => prompts.length === 2)
      const third = sessionManager.enqueuePrompt(session.id, 'third')

      gates[1].resolve()
      await waitUntil(() => prompts.length === 3)
      expect(prompts[1]).toContain('second')
      expect(prompts[1]).not.toContain('third')
      expect(prompts[2]).toBe('third')

      gates[2].resolve()
      await Promise.all([first, second, third])
    } finally {
      gates.forEach((gate) => gate.resolve())
      acpHost.ensureSession = originalEnsureSession
      acpHost.prompt = originalPrompt
    }
  })

  test('closed sessions reject new prompts', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-existing' })
    sessionStore.updateStatus(session.id, 'closed')

    await expect(sessionManager.sendPrompt(session.id, 'hello')).rejects.toThrow('当前会话已关闭')
  })

  test('模板会话拒绝 sendPrompt', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-template', isTemplate: true })

    await expect(sessionManager.sendPrompt(session.id, 'hello')).rejects.toThrow('模板会话不能直接发送消息')
  })

  test('模板会话拒绝 enqueuePrompt', async () => {
    const agent = agentStore.create({ name: 'Mock', type: 'dev', runtime: 'mock' })
    const session = sessionStore.create({ agentId: agent.id, acpSessionId: 'acp-template', isTemplate: true })

    await expect(sessionManager.enqueuePrompt(session.id, 'hello')).rejects.toThrow('模板会话不能直接发送消息')
  })
})

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for prompt')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
  }
}
