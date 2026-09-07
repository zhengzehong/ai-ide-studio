import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { advisorDefaultPromptMigration } from '../../src/store/migrations/063-advisor-default-prompt.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { projectAdvisorStore } from '../../src/store/advisors.js'
import { advisorSuggestionStore } from '../../src/store/advisor-suggestions.js'
import { sessionStore, messageStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { advisorRpcHandlers } from '../../src/gateway/rpc/advisor.js'
import { buildAdvisorPushPrompt } from '../../src/core/advisor-push.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'advisor-config-'))
  initDatabase(resolve(root, 'test.sqlite'))
})
afterEach(() => { closeDatabase(); rmSync(root, { recursive: true, force: true }) })

test('migration recognizes exact historical defaults, backs them up and preserves custom edits', () => {
  const legacy = readFileSync(new URL('../fixtures/advisor-default-v4.txt', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .trim()
  const crlfLegacy = legacy.replace(/\n/g, '\r\n')
  const p = projectStore.create({ name: '旧默认', workDir: root })
  const custom = projectStore.create({ name: '自定义', workDir: root })
  projectAdvisorStore.update(p.id, { advisorPrompt: crlfLegacy })
  projectAdvisorStore.update(custom.id, { advisorPrompt: legacy + '\n只推荐写作选题' })
  getDb().transaction(() => advisorDefaultPromptMigration.up(getDb()))()
  expect(projectAdvisorStore.get(p.id)?.advisor_prompt).toBe('')
  expect(projectAdvisorStore.get(custom.id)?.advisor_prompt).toBe(legacy + '\n只推荐写作选题')
  const before = getDb().prepare('SELECT value FROM settings WHERE key = ?')
    .get('advisor_prompt_backup:064:' + p.id)
  expect(before).toEqual({ value: crlfLegacy })
  advisorDefaultPromptMigration.up(getDb())
  expect(getDb().prepare('SELECT value FROM settings WHERE key = ?').get('advisor_prompt_backup:064:' + p.id)).toEqual(before)
})

test('RPC distinguishes reset from omission and returns backend-owned defaults', async () => {
  const p = projectStore.create({ name: '写作', workDir: root })
  const a = agentStore.create({ type: 'pm', name: '编辑', runtime: 'mock', projectId: p.id })
  const sendResult = vi.fn()
  const context: RpcContext = {
    state: { authMode: 'owner', subscriptions: new Set() }, sendResult,
    sendError: vi.fn(), sendOutOfBandError: vi.fn(),
  }
  const msg = { type: 'advisor.configure', projectId: p.id, advisorAgentId: a.id }
  await advisorRpcHandlers['advisor.configure']!({ ...msg, advisorPrompt: '关注选题' }, context)
  await advisorRpcHandlers['advisor.configure']!({ ...msg, enabled: false }, context)
  expect(projectAdvisorStore.get(p.id)?.advisor_prompt).toBe('关注选题')
  await advisorRpcHandlers['advisor.configure']!({ ...msg, advisorPrompt: '' }, context)
  expect(projectAdvisorStore.get(p.id)?.advisor_prompt).toBe('')
  expect(sendResult.mock.lastCall?.[0]).toMatchObject({ advisorPrompt: '', defaultAdvisorPrompt: expect.stringContaining('写作') })
  expect(sendResult.mock.lastCall?.[0].defaultAdvisorPrompt).not.toContain('服务于项目开发者')
})

test('batch context retains coverage and feedback under large input, with multiple real sources', () => {
  const p = projectStore.create({ name: '写作', workDir: root })
  const a = agentStore.create({ type: 'pm', name: '作者', runtime: 'mock', projectId: p.id })
  const sessions = [0, 1].map(() => sessionStore.create({ agentId: a.id, projectId: p.id }))
  const task = taskStore.create({ title: '正在写小说', description: '已经覆盖开篇修改', projectId: p.id, initiatorSessionId: sessions[0]!.id })
  taskStore.update(task.id, { status: 'running' })
  for (let i = 0; i < 30; i++) {
    advisorSuggestionStore.replaceRound(p.id, 'pending-' + i, null, [{
      type: 'action', title: '待看' + i + '字'.repeat(150), descriptionMarkdown: '正文', sourceEvidence: [],
    }])
  }
  const [ignored] = advisorSuggestionStore.replaceRound(p.id, 'feedback', null, [{
    type: 'action', title: '已忽略的选题', descriptionMarkdown: '正文', sourceEvidence: [],
  }])
  advisorSuggestionStore.ignore(ignored!.id)
  const batch = sessions.map((s, i) => {
    for (let j = 0; j < 4; j++) messageStore.append(s.id, { role: 'agent', content: '旧消息'.repeat(2000) })
    messageStore.append(s.id, { role: 'human', content: '输入' + i + '字'.repeat(5000) })
    const message = messageStore.append(s.id, { role: 'agent', content: '结论' + i })
    return { sessionId: s.id, agentId: a.id, messageId: message.id, turnId: 'turn-' + i, stopReason: 'end_turn' }
  })
  const { prompt } = buildAdvisorPushPrompt(p.id, batch, '', 'batch')
  expect(prompt.length).toBeLessThan(8100)
  expect(prompt).toContain(task.id)
  expect(prompt).toContain('已经覆盖开篇修改')
  expect(prompt).toContain('已忽略的选题')
  for (const s of sessions) expect(prompt).toContain(s.id)
  expect(prompt).toContain('结论0')
  expect(prompt).toContain('结论1')
  expect(prompt).toContain('未展示不等于不存在')
})
