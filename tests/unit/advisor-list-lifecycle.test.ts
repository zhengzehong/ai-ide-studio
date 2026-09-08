import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase, getDb } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { taskStore } from '../../src/store/tasks.js'
import { advisorSuggestionStore } from '../../src/store/advisor-suggestions.js'
import { ignoreSuggestion, listAdvisorSuggestionsFor, acceptSuggestion } from '../../src/core/project-advisor.js'
import { advisorRpcHandlers } from '../../src/gateway/rpc/advisor.js'
import type { RpcContext } from '../../src/gateway/rpc/types.js'

let root: string
let projectId: string
const start = Date.parse('2026-09-01T00:00:00.000Z')
function at(hours: number): string { return new Date(start + hours * 3_600_000).toISOString() }
function createSuggestion(project = projectId, hours = 0): ReturnType<typeof advisorSuggestionStore.replaceRound>[number] {
  return advisorSuggestionStore.replaceRound(project, crypto.randomUUID(), null, [{
    type: 'action', title: '建议', descriptionMarkdown: '执行说明', sourceEvidence: [],
  }], at(hours))[0]!
}
function context(): RpcContext {
  return { state: { authMode: 'owner', subscriptions: new Set() }, sendResult: vi.fn(), sendError: vi.fn(), sendOutOfBandError: vi.fn() }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start + 3_600_000)
  root = mkdtempSync(resolve(tmpdir(), 'advisor-lifecycle-'))
  initDatabase(resolve(root, 'test.sqlite'))
  projectId = projectStore.create({ name: '测试项目', workDir: root }).id
})
afterEach(() => { closeDatabase(); rmSync(root, { recursive: true, force: true }); vi.useRealTimers() })

test('new and legacy suggestions expire exactly at 24h, including the count and response deadline', () => {
  const row = createSuggestion()
  expect(row.expire_at).toBe(at(24))
  getDb().prepare('UPDATE advisor_suggestions SET expire_at = ? WHERE id = ?').run(at(168), row.id)
  expect(advisorSuggestionStore.listActive(projectId, at(23.999))[0]?.expire_at).toBe(at(24))
  expect(advisorSuggestionStore.listActive(projectId, at(24))).toHaveLength(0)
  expect(advisorSuggestionStore.countPending(projectId, at(24))).toBe(0)
  expect(advisorSuggestionStore.claimDispatch(row.id, 'late', at(24))).toBeUndefined()
  expect(advisorSuggestionStore.markViewed(projectId, null, at(24))).toBe(0)
  vi.setSystemTime(Date.parse(at(25)))
  expect(listAdvisorSuggestionsFor(projectId)).toMatchObject({ suggestions: [], expired: [], settled: [], pendingCount: 0 })
})

test('ignored rows disappear from every display list but remain feedback, including repeat ignores', () => {
  const row = createSuggestion()
  expect(ignoreSuggestion(projectId, row.id)).toMatchObject({ suggestions: [], settled: [], expired: [] })
  expect(ignoreSuggestion(projectId, row.id).suggestions).toHaveLength(0)
  expect(advisorSuggestionStore.listRecentFeedback(projectId)[0]?.id).toBe(row.id)
  expect(advisorSuggestionStore.get(row.id)?.status).toBe('ignored')
})

test('an earlier explicit deadline is preserved and an expired suggestion cannot create a task', async () => {
  const row = createSuggestion()
  getDb().prepare('UPDATE advisor_suggestions SET expire_at = ? WHERE id = ?').run(at(0.5), row.id)
  expect(advisorSuggestionStore.listActive(projectId)).toHaveLength(0)
  await expect(acceptSuggestion(projectId, row.id, { execute: false })).rejects.toThrow('已过期')
})

test('bulk ignore handles only the snapshot in this project and never clears a dispatch claim', () => {
  const first = createSuggestion()
  const busy = createSuggestion()
  const otherProject = projectStore.create({ name: '另一个项目', workDir: root }).id
  const other = createSuggestion(otherProject)
  const lateArrival = createSuggestion()
  advisorSuggestionStore.claimDispatch(busy.id, 'running')
  const rpc = advisorRpcHandlers['advisor.suggestion.ignoreAll']
  expect(rpc).toBeTypeOf('function')
  const ctx = context()
  rpc!({ type: 'advisor.suggestion.ignoreAll', projectId, ids: [first.id, first.id, busy.id, other.id] }, ctx)
  expect(ctx.sendResult).toHaveBeenCalledWith(expect.objectContaining({ ignoredCount: 1 }))
  expect(advisorSuggestionStore.get(first.id)?.status).toBe('ignored')
  expect(advisorSuggestionStore.get(busy.id)?.dispatch_token).toBe('running')
  expect(advisorSuggestionStore.ignore(busy.id)).toBeUndefined()
  expect(advisorSuggestionStore.get(other.id)?.status).toBe('pending')
  expect(advisorSuggestionStore.get(lateArrival.id)?.status).toBe('pending')
  rpc!({ type: 'advisor.suggestion.ignoreAll', projectId, ids: [first.id] }, ctx)
  expect(ctx.sendResult).toHaveBeenLastCalledWith(expect.objectContaining({ ignoredCount: 0 }))
})

test('bulk ignore validates owner and a bounded nonempty snapshot', () => {
  const rpc = advisorRpcHandlers['advisor.suggestion.ignoreAll']
  expect(rpc).toBeTypeOf('function')
  const ctx = context()
  expect(() => rpc!({ type: 'advisor.suggestion.ignoreAll', projectId, ids: [] }, ctx)).toThrow()
  expect(() => rpc!({ type: 'advisor.suggestion.ignoreAll', projectId, ids: [''] }, ctx)).toThrow()
  expect(() => rpc!({ type: 'advisor.suggestion.ignoreAll', projectId, ids: Array(2001).fill('id') }, ctx)).toThrow()
  ctx.state.authMode = 'guest'
  expect(() => rpc!({ type: 'advisor.suggestion.ignoreAll', projectId, ids: ['id'] }, ctx)).toThrow('访客')
})

test('completed task records and feedback survive display expiry and bulk ignore', () => {
  const row = createSuggestion()
  const task = taskStore.create({ title: '已创建任务', description: '执行说明', projectId })
  advisorSuggestionStore.claimDispatch(row.id, 'done')
  advisorSuggestionStore.completeDispatch(row.id, 'done', task.id, null, 'created')
  expect(advisorSuggestionStore.ignoreMany(projectId, [row.id])).toBe(0)
  expect(listAdvisorSuggestionsFor(projectId).settled).toHaveLength(1)
  vi.setSystemTime(Date.parse(at(24)))
  expect(listAdvisorSuggestionsFor(projectId).settled).toHaveLength(0)
  expect(advisorSuggestionStore.get(row.id)?.task_id).toBe(task.id)
  expect(taskStore.get(task.id)).toBeDefined()
  expect(advisorSuggestionStore.listRecentFeedback(projectId)[0]?.id).toBe(row.id)
})

test('expiry and cleanup cannot clear a live dispatch token', () => {
  const row = createSuggestion()
  advisorSuggestionStore.claimDispatch(row.id, 'in-flight')
  vi.setSystemTime(Date.parse(at(49)))
  expect(advisorSuggestionStore.ignoreMany(projectId, [row.id])).toBe(0)
  expect(advisorSuggestionStore.purgeExpiredUnprocessed()).toHaveLength(0)
  expect(advisorSuggestionStore.get(row.id)?.dispatch_token).toBe('in-flight')
})
