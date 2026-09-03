import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { advisorSuggestionStore, type CreateAdvisorSuggestionInput } from '../../src/store/advisor-suggestions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-advisor-suggestions-store-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

function suggestionInput(overrides: Partial<CreateAdvisorSuggestionInput> = {}): CreateAdvisorSuggestionInput {
  return {
    type: 'action',
    title: '拆分超长会话上下文',
    descriptionMarkdown: '## 背景\n上下文过长导致回复变慢。\n## 目标\n拆分历史并压缩。\n## 验收\n回复恢复正常速度。',
    sourceEvidence: [{ sessionId: 'sess-1', title: '性能排查' }],
    ...overrides,
  }
}

function createExecutionFixture(projectId: string) {
  const agent = agentStore.create({ type: 'dev', name: '执行者', runtime: 'mock', projectId })
  const session = sessionStore.create({ agentId: agent.id, projectId })
  const task = taskStore.create({ title: '已有任务', description: '占位', projectId })
  return { agent, session, task }
}

describe('advisor suggestion store', () => {
  test('replaceRound appends across rounds and overwrites within a round', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const first = advisorSuggestionStore.replaceRound(project.id, 'round-1', 'sess-a', [suggestionInput()])
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ project_id: project.id, round_id: 'round-1', trigger_session_id: 'sess-a', status: 'pending', sort_order: 0 })

    const second = advisorSuggestionStore.replaceRound(project.id, 'round-2', 'sess-b', [suggestionInput({ title: '另一轮建议' })])
    expect(advisorSuggestionStore.listAllByProject(project.id)).toHaveLength(2)

    // 轮内覆盖：同 roundId 重新提交，旧的 pending 被清掉、sort_order 重新从 0 编
    const overwritten = advisorSuggestionStore.replaceRound(project.id, 'round-2', 'sess-b', [
      suggestionInput({ title: '覆盖后的建议一' }),
      suggestionInput({ title: '覆盖后的建议二' }),
    ])
    const all = advisorSuggestionStore.listAllByProject(project.id)
    expect(all).toHaveLength(3)
    expect(all.filter((row) => row.round_id === 'round-2').map((row) => row.id).sort())
      .toEqual(overwritten.map((row) => row.id).sort())
    expect(overwritten.map((row) => row.sort_order)).toEqual([0, 1])
    expect(second.every((row) => advisorSuggestionStore.get(row.id) === undefined)).toBe(true)
  })

  test('listActive only returns unexpired pending/viewed rows and countPending tracks pending only', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const now = new Date('2026-09-03T10:00:00.000Z')
    const rows = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionInput(),
      suggestionInput({ title: '第二条' }),
    ], now.toISOString())

    advisorSuggestionStore.markViewed(project.id, [rows[0].id], now.toISOString())
    advisorSuggestionStore.ignore(rows[1].id, now.toISOString())

    expect(advisorSuggestionStore.countPending(project.id, now.toISOString())).toBe(0)
    const active = advisorSuggestionStore.listActive(project.id, now.toISOString())
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe('viewed')

    // 过期后从 active 消失，进入 expiredPending（24h 窗口内），徽标归零
    const expiredAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() // = expire_at
    const twoHoursAfterExpire = new Date(now.getTime() + (7 * 24 + 2) * 60 * 60 * 1000).toISOString()
    expect(advisorSuggestionStore.listActive(project.id, twoHoursAfterExpire)).toHaveLength(0)
    expect(advisorSuggestionStore.listExpiredPending(project.id, twoHoursAfterExpire)).toHaveLength(1)
    expect(advisorSuggestionStore.countPending(project.id, twoHoursAfterExpire)).toBe(0)

    // 隔天口径：过期超 24h 不再返回（前端「已过期」组消失）
    const oneDayAfterExpire = new Date(now.getTime() + (7 * 24 + 25) * 60 * 60 * 1000).toISOString()
    expect(advisorSuggestionStore.listExpiredPending(project.id, oneDayAfterExpire)).toHaveLength(0)
  })

  test('purgeExpiredUnprocessed removes unprocessed rows expired over 24h and keeps settled rows', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const now = new Date('2026-09-03T10:00:00.000Z')
    const rows = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionInput({ title: '未处理过期' }),
      suggestionInput({ title: '未处理刚过期' }),
      suggestionInput({ title: '已接受台账' }),
    ], now.toISOString())
    advisorSuggestionStore.ignore(rows[2].id, now.toISOString())

    const setExpireAt = (id: string, value: string): void => {
      getDb().prepare(`UPDATE advisor_suggestions SET expire_at = ? WHERE id = ?`).run(value, id)
    }
    // purge 时刻 = now + 8 天，cutoff = now + 7 天：expire_at 早于 cutoff 的未处理行被判死
    setExpireAt(rows[0].id, new Date(now.getTime() + (7 * 24 - 1) * 60 * 60 * 1000).toISOString()) // 早于 cutoff → 删
    setExpireAt(rows[1].id, new Date(now.getTime() + (7 * 24 + 2) * 60 * 60 * 1000).toISOString()) // 晚于 cutoff → 留

    const purged = advisorSuggestionStore.purgeExpiredUnprocessed(new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString())
    expect(purged.map((row) => row.id)).toEqual([rows[0].id])
    expect(advisorSuggestionStore.get(rows[0].id)).toBeUndefined()
    expect(advisorSuggestionStore.get(rows[1].id)).toBeDefined()
    expect(advisorSuggestionStore.get(rows[2].id)).toBeDefined() // 终态台账永久保留
  })

  test('markViewed moves pending to viewed but never touches settled rows', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const rows = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionInput(),
      suggestionInput({ title: '第二条' }),
    ])
    advisorSuggestionStore.ignore(rows[1].id)

    expect(advisorSuggestionStore.markViewed(project.id, [rows[0].id])).toBe(1)
    expect(advisorSuggestionStore.markViewed(project.id, [rows[1].id])).toBe(0)
    // 全量已读：只影响 pending
    expect(advisorSuggestionStore.markViewed(project.id, null)).toBe(0)
    expect(advisorSuggestionStore.get(rows[0].id)?.status).toBe('viewed')
    expect(advisorSuggestionStore.get(rows[1].id)?.status).toBe('ignored')
  })

  test('dispatch token serializes task creation and recovers from failure', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const { session, task } = createExecutionFixture(project.id)
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [suggestionInput()])

    expect(advisorSuggestionStore.claimDispatch(row.id, 'token-1')).toBeTruthy()
    // 并发第二笔 claim 失败（L-7 防双击）
    expect(advisorSuggestionStore.claimDispatch(row.id, 'token-2')).toBeUndefined()
    // 令牌不匹配的 complete 不生效
    expect(advisorSuggestionStore.completeDispatch(row.id, 'token-2', task.id, session.id, 'created')?.task_id).toBeNull()

    // 失败释放令牌后可重试
    advisorSuggestionStore.releaseDispatch(row.id, 'token-1')
    expect(advisorSuggestionStore.claimDispatch(row.id, 'token-3')).toBeTruthy()
    const done = advisorSuggestionStore.completeDispatch(row.id, 'token-3', task.id, session.id, 'created')
    expect(done).toMatchObject({ task_id: task.id, execution_session_id: session.id, status: 'created', dispatch_token: null })
    // 终态不能再占用
    expect(advisorSuggestionStore.claimDispatch(row.id, 'token-4')).toBeUndefined()
  })

  test('completeDispatch accepts a suggestion with an execution session', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const { session, task } = createExecutionFixture(project.id)
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [suggestionInput()])
    advisorSuggestionStore.claimDispatch(row.id, 'token-1')
    const done = advisorSuggestionStore.completeDispatch(row.id, 'token-1', task.id, session.id, 'accepted')
    expect(done).toMatchObject({ status: 'accepted', task_id: task.id })
    expect(advisorSuggestionStore.listSettled(project.id)).toHaveLength(1)
  })

  test('releaseStaleDispatches frees tokens left by a restart', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const [first, second] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionInput(),
      suggestionInput({ title: '第二条' }),
    ])
    advisorSuggestionStore.claimDispatch(first.id, 'token-1')
    advisorSuggestionStore.claimDispatch(second.id, 'token-2')

    expect(advisorSuggestionStore.releaseStaleDispatches()).toBe(2)
    expect(advisorSuggestionStore.get(first.id)?.dispatch_token).toBeNull()
    expect(advisorSuggestionStore.get(second.id)?.dispatch_token).toBeNull()
  })

  test('persistArtifact stores path and preview id without the html body', () => {
    const project = projectStore.create({ name: 'P', workDir: root })
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionInput({ type: 'plan', artifact: { name: '方案.html', relativePath: 'tmp', size: 12 } }),
    ])
    const updated = advisorSuggestionStore.persistArtifact(row.id, { fileName: '方案.html', size: 2048 }, 'prev-123')
    expect(JSON.parse(updated!.artifact_json!)).toEqual({
      name: '方案.html',
      relativePath: `advisor-artifacts/${project.id}`,
      size: 2048,
      previewId: 'prev-123',
    })
  })
})
