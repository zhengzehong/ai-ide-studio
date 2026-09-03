import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  acceptSuggestion,
  configureAdvisor,
  getAdvisorWorkspace,
  handleSessionTurnDone,
  ignoreSuggestion,
  resumeProjectAdvisors,
  DEFAULT_ADVISOR_PROMPT,
} from '../../src/core/project-advisor.js'
import { buildAdvisorPushPrompt } from '../../src/core/advisor-push.js'
import { sessionManager } from '../../src/core/sessions.js'
import { taskStepManager } from '../../src/core/task-steps.js'
import { advisorSuggestionStore } from '../../src/store/advisor-suggestions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectAdvisorStore } from '../../src/store/advisors.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { messageStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { taskStore } from '../../src/store/tasks.js'
import { getHandler } from '../../src/tools/handlers/index.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-project-advisor-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  closeDatabase()
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

function createFixture() {
  const project = projectStore.create({ name: 'P', workDir: root })
  const advisor = agentStore.create({ type: 'pm', name: '参谋', runtime: 'mock', projectId: project.id })
  const advisorSession = sessionStore.create({ agentId: advisor.id, projectId: project.id })
  const executor = agentStore.create({ type: 'dev', name: '执行者', runtime: 'mock', projectId: project.id })
  const workerSession = sessionStore.create({ agentId: executor.id, projectId: project.id })
  return { project, advisor, advisorSession, executor, workerSession }
}

function turnDone(sessionId: string, agentId: string, turnId: string) {
  return { sessionId, agentId, messageId: `msg-${turnId}`, turnId, stopReason: 'end_turn' as const }
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  }
  throw new Error('condition was not met')
}

const DESCRIPTION = [
  '## 背景',
  '执行会话反馈同一个排查问题反复出现，结论没有沉淀成可复用的任务说明，团队在重复劳动。',
  '## 目标',
  '把排查结论整理成结构化的任务描述并派发执行，形成可追踪的改进闭环。',
  '## 交付物',
  '一份沉淀后的任务说明与执行记录。',
  '## 验收标准',
  '任务创建成功并进入执行会话，后续同类问题可直接引用。',
].join('\n')

function suggestionPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'action',
    title: '沉淀排查结论为任务',
    descriptionMarkdown: DESCRIPTION,
    sourceEvidence: [{ sessionId: 'sess-worker', title: '排查会话' }],
    ...overrides,
  }
}

describe('project advisor service', () => {
  test('configures an advisor with a dedicated session and validates the agent', async () => {
    const { project, advisor } = createFixture()

    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    expect(config.advisorAgentId).toBe(advisor.id)
    expect(config.enabled).toBe(true)
    expect(config.advisorPrompt).toBe(DEFAULT_ADVISOR_PROMPT)
    const session = sessionStore.get(config.sessionId!)
    expect(session).toMatchObject({ agent_id: advisor.id, project_id: project.id, purpose: 'conversation' })
    expect(session?.title).toBe('项目参谋会话')

    await expect(configureAdvisor(project.id, { advisorAgentId: 'agent-missing' })).rejects.toThrow('参谋 Agent 不存在')

    const other = projectStore.create({ name: 'Q', workDir: root })
    const foreign = agentStore.create({ type: 'dev', name: '外部执行者', runtime: 'mock', projectId: other.id })
    await expect(configureAdvisor(project.id, { advisorAgentId: foreign.id })).rejects.toThrow('不属于当前项目')
  })

  test('injects a push turn into the advisor session and records the trigger session', async () => {
    const { project, advisor, executor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true, advisorPrompt: '关注性能问题' })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-9'))
    await waitUntil(() => enqueue.mock.calls.length === 1)

    const [sessionId, prompt, images, options] = enqueue.mock.calls[0]!
    expect(sessionId).toBe(config.sessionId)
    expect(images).toBeUndefined()
    expect(prompt).toContain('## 用户配置的参谋偏好\n关注性能问题')
    expect(prompt).toContain('advisor-turn-9')
    expect(prompt).toContain(`agent.session.messages（sessionId = "${workerSession.id}"）`)
    expect(options).toMatchObject({
      contextProjectId: project.id,
      senderRole: 'advisor',
      senderName: 'AI 参谋',
      batchKey: 'advisor-round:advisor-turn-9',
      dedupeKey: 'advisor:advisor-turn-9',
    })

    // 注入时登记的 roundId → 来源会话映射，发布时写回台账
    const result = await getHandler('suggestion.present')!.execute({
      roundId: 'advisor-turn-9',
      suggestions: [suggestionPayload()],
    }, { projectId: project.id, sessionId: config.sessionId! })
    expect(result.isError).not.toBe(true)
    const [row] = advisorSuggestionStore.listAllByProject(project.id)
    expect(row).toMatchObject({ round_id: 'advisor-turn-9', trigger_session_id: workerSession.id })
  })

  test('skips disabled advisors, self-triggered turns, and non-conversation sessions', async () => {
    const { project, advisor, executor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: false })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-1'))
    handleSessionTurnDone(turnDone(config.sessionId!, advisor.id, 'turn-2'))
    const autonomySession = sessionStore.create({ agentId: executor.id, projectId: project.id, purpose: 'autonomy' })
    handleSessionTurnDone(turnDone(autonomySession.id, executor.id, 'turn-3'))
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))

    expect(enqueue).not.toHaveBeenCalled()

    // 启用后同参数即可注入（证明上面是被过滤而不是配置缺失）
    projectAdvisorStore.update(project.id, { enabled: true })
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-4'))
    await waitUntil(() => enqueue.mock.calls.length === 1)
  })

  test('keeps only the newest turn per session inside the debounce window (T-3)', async () => {
    vi.useFakeTimers()
    const { project, advisor, executor, workerSession } = createFixture()
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-a'))
    for (let attempt = 0; attempt < 100 && enqueue.mock.calls.length < 1; attempt += 1) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]![1]).toContain('advisor-turn-a')

    // 5 分钟窗口内同会话第二轮：覆盖暂存快照不逐轮注入；窗口结束后只推最新一轮
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-b'))
    expect(enqueue).toHaveBeenCalledTimes(1)
    for (let attempt = 0; attempt < 200 && enqueue.mock.calls.length < 2; attempt += 1) {
      await vi.advanceTimersByTimeAsync(5_000)
    }
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue.mock.calls[1]![1]).toContain('advisor-turn-b')
  })

  test('defers a burst from another session until the project interval elapses', async () => {
    vi.useFakeTimers()
    const { project, advisor, executor, workerSession } = createFixture()
    const secondAgent = agentStore.create({ type: 'dev', name: '第二执行者', runtime: 'mock', projectId: project.id })
    const secondSession = sessionStore.create({ agentId: secondAgent.id, projectId: project.id })
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-x'))
    for (let attempt = 0; attempt < 100 && enqueue.mock.calls.length < 1; attempt += 1) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(enqueue).toHaveBeenCalledTimes(1)

    // 3 分钟内的第二个会话事件进入 pendingTimer，间隔满足后合并注入
    handleSessionTurnDone(turnDone(secondSession.id, secondAgent.id, 'turn-y'))
    expect(enqueue).toHaveBeenCalledTimes(1)
    for (let attempt = 0; attempt < 100 && enqueue.mock.calls.length < 2; attempt += 1) {
      await vi.advanceTimersByTimeAsync(2_000)
    }
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue.mock.calls[1]![0]).toBe(config.sessionId)
  })

  test('accepts a suggestion as a draft task without dispatching it', async () => {
    const { project, executor } = createFixture()
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionPayload({ suggestedAgentId: executor.id, agentReason: '适合执行' }),
    ])
    const dispatch = vi.spyOn(taskStepManager, 'dispatchStep')

    const view = await acceptSuggestion(project.id, row.id, { execute: false })
    const accepted = view.settled.find((item) => item.id === row.id)!
    expect(accepted.status).toBe('created')
    expect(accepted.task_id).toBeTruthy()
    expect(accepted.dispatch_token).toBeNull()

    const task = taskStore.get(accepted.task_id!)!
    expect(task).toMatchObject({ status: 'draft', source: 'advisor', title: '沉淀排查结论为任务' })
    expect(dispatch).not.toHaveBeenCalled()

    // 幂等：重复接受返回同一任务
    const again = await acceptSuggestion(project.id, row.id, { execute: false })
    expect(again.settled.find((item) => item.id === row.id)?.task_id).toBe(accepted.task_id)
  })

  test('dispatches immediately when the user chooses execute', async () => {
    const { project, executor } = createFixture()
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionPayload({ suggestedAgentId: executor.id }),
    ])
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    const view = await acceptSuggestion(project.id, row.id, { execute: true })
    const accepted = view.settled.find((item) => item.id === row.id)!
    expect(accepted.status).toBe('accepted')
    const task = taskStore.get(accepted.task_id!)!
    expect(task.status).toBe('running')
    expect(sessionStore.get(accepted.execution_session_id!)?.agent_id).toBe(executor.id)
  })

  test('applies user-edited title and description when accepting (U-13)', async () => {
    const { project, executor } = createFixture()
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionPayload({ suggestedAgentId: executor.id }),
    ])
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    const view = await acceptSuggestion(project.id, row.id, {
      execute: true,
      title: '用户改过的标题',
      descriptionMarkdown: '## 用户改过的说明',
    })
    const accepted = view.settled.find((item) => item.id === row.id)!
    const task = taskStore.get(accepted.task_id!)!
    expect(task).toMatchObject({ title: '用户改过的标题' })
    expect(task.description).toContain('用户改过的说明')

    // 不传则回落建议原文
    const [second] = advisorSuggestionStore.replaceRound(project.id, 'round-2', null, [
      suggestionPayload({ suggestedAgentId: executor.id }),
    ])
    const fallbackView = await acceptSuggestion(project.id, second.id, { execute: false })
    const fallbackTask = taskStore.get(fallbackView.settled.find((item) => item.id === second.id)!.task_id!)!
    expect(fallbackTask.title).toBe('沉淀排查结论为任务')
  })

  test('releases the dispatch token when task creation fails so the user can retry', async () => {
    const { project, executor } = createFixture()
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionPayload({ suggestedAgentId: executor.id }),
    ])
    vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    vi.spyOn(taskStepManager, 'dispatchStep').mockRejectedValueOnce(new Error('dispatch failed'))

    await expect(acceptSuggestion(project.id, row.id, { execute: true })).rejects.toThrow('dispatch failed')
    expect(advisorSuggestionStore.get(row.id)?.dispatch_token).toBeNull()

    // 释放后可重试成功
    const view = await acceptSuggestion(project.id, row.id, { execute: true })
    expect(view.settled.find((item) => item.id === row.id)?.task_id).toBeTruthy()
  })

  test('rejects acceptance without a usable agent and ignores pending suggestions', async () => {
    const { project } = createFixture()
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [suggestionPayload()])

    await expect(acceptSuggestion(project.id, row.id, { execute: false })).rejects.toThrow('没有推荐 Agent')

    const view = ignoreSuggestion(project.id, row.id)
    expect(view.suggestions.find((item) => item.id === row.id)).toBeUndefined()
    expect(view.settled).toHaveLength(1)
    expect(view.settled[0]).toMatchObject({ id: row.id, status: 'ignored' })
  })

  test('exposes a default workspace and resumes stale dispatch tokens on startup', async () => {
    const { project, advisor, executor, workerSession } = createFixture()
    const workspace = getAdvisorWorkspace(project.id)
    expect(workspace.config.advisorPrompt).toBe(DEFAULT_ADVISOR_PROMPT)
    expect(workspace.config.enabled).toBe(true)
    expect(workspace.suggestions).toMatchObject({ suggestions: [], expired: [], settled: [], pendingCount: 0 })

    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-1', null, [
      suggestionPayload({ suggestedAgentId: executor.id }),
    ])
    advisorSuggestionStore.claimDispatch(row.id, 'stale-token')
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-r'))
    await resumeProjectAdvisors()

    expect(advisorSuggestionStore.get(row.id)?.dispatch_token).toBeNull()
  })

  test('settles an advisor round that ended without calling suggestion.present (S-8)', async () => {
    const { project, advisor, executor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-s8'))
    await waitUntil(() => enqueue.mock.calls.length === 1)

    // 参谋会话完成一轮但从未提交建议：该轮登记被结算回收，不产卡
    handleSessionTurnDone({
      sessionId: config.sessionId!,
      agentId: advisor.id,
      messageId: 'msg-advisor-done',
      turnId: 'advisor-done-1',
      stopReason: 'end_turn',
    })

    // 登记已回收：同 roundId 之后再提交，不再视为该轮触发会话
    const result = await getHandler('suggestion.present')!.execute({
      roundId: 'advisor-turn-s8',
      suggestions: [suggestionPayload()],
    }, { projectId: project.id, sessionId: config.sessionId! })
    expect(result.isError).not.toBe(true)
    const [row] = advisorSuggestionStore.listAllByProject(project.id)
    expect(row.round_id).toBe('advisor-turn-s8')
    expect(row.trigger_session_id).toBeNull()
  })

  test('prunes round registrations older than ten minutes on the next write', async () => {
    vi.useFakeTimers()
    const { project, advisor, executor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)

    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-old'))
    for (let attempt = 0; attempt < 100 && enqueue.mock.calls.length < 1; attempt += 1) {
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(enqueue).toHaveBeenCalledTimes(1)

    // 越过 TTL 后下一个轮次写入时惰性回收旧登记
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'turn-new'))
    for (let attempt = 0; attempt < 100 && enqueue.mock.calls.length < 2; attempt += 1) {
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(enqueue).toHaveBeenCalledTimes(2)

    const result = await getHandler('suggestion.present')!.execute({
      roundId: 'advisor-turn-old',
      suggestions: [suggestionPayload({ title: '旧轮建议补交' })],
    }, { projectId: project.id, sessionId: config.sessionId! })
    expect(result.isError).not.toBe(true)
    const row = advisorSuggestionStore.listAllByProject(project.id).find((item) => item.round_id === 'advisor-turn-old')
    expect(row?.trigger_session_id).toBeNull()
  })

  test('trims the push package stepwise when it exceeds the total limit (C-2)', () => {
    const { project, executor, workerSession } = createFixture()
    // 大量 pending 建议标题撑爆聚合面（每条接近 160 字符裁剪上限）
    for (let batch = 0; batch < 30; batch += 1) {
      advisorSuggestionStore.replaceRound(project.id, `round-fill-${batch}`, null, [
        suggestionPayload({ title: `历史建议${batch}号${'内容填充'.repeat(38)}` }),
      ])
    }
    const longInput = '用户输入'.repeat(400)
    const longReply = 'AI 回复内容填充'.repeat(400)
    messageStore.append(workerSession.id, { role: 'human', content: longInput })
    messageStore.append(workerSession.id, { role: 'agent', content: longReply })

    const { prompt, roundId } = buildAdvisorPushPrompt(project.id, turnDone(workerSession.id, executor.id, 'turn-trim'), '')

    expect(roundId).toBe('advisor-turn-trim')
    expect(prompt.length).toBeLessThanOrEqual(8_100)
    expect(prompt).toContain('advisor-turn-trim')
    expect(prompt).toContain('用户输入')
    // 聚合面被裁剪：pending 建议标题不会全量保留
    const pendingLines = prompt.split('\n').filter((line) => line.startsWith('- 历史建议'))
    expect(pendingLines.length).toBeLessThan(30)
    expect(prompt).toContain('AI 回复内容填充')
  })
})
