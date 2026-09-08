import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  acceptSuggestion,
  configureAdvisor,
  rebuildAdvisorSession,
  getAdvisorWorkspace,
  handleSessionTurnDone,
  ignoreSuggestion,
  publishSuggestions as publishRegisteredSuggestions,
  resumeProjectAdvisors,
  DEFAULT_ADVISOR_PROMPT,
} from '../../src/core/project-advisor.js'
import { registerAdvisorRound } from '../../src/core/advisor-rounds.js'
import { disposeAdvisorScheduling } from '../../src/core/advisor-turns.js'
import { ADVISOR_BATCH_MS } from '../../src/core/advisor-batch-scheduler.js'
import { buildAdvisorPushPrompt } from '../../src/core/advisor-push.js'
import { sessionManager } from '../../src/core/sessions.js'
import { taskStepManager } from '../../src/core/task-steps.js'
import { advisorSuggestionStore } from '../../src/store/advisor-suggestions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectAdvisorStore } from '../../src/store/advisors.js'
import { closeDatabase, getDb, getDbPath, initDatabase } from '../../src/store/db.js'
import { messageStore } from '../../src/store/sessions.js'
import { projectStore } from '../../src/store/projects.js'
import { previewStore } from '../../src/store/previews.js'
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
  disposeAdvisorScheduling()
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
  '执行会话反馈同一个排查问题反复出现（最近三次分别在 sess-worker 的三轮排查里），结论没有沉淀成可复用的任务说明，团队在重复劳动。参谋核实：任务库里没有任何 running 任务覆盖「排查结论沉淀」这件事，属于线外缺口。',
  '## 方案',
  '第一步，把三次排查的根因结论整理成结构化文档（含报错原文、涉及模块、复现条件）；第二步，创建沉淀任务并派发给值班执行 Agent，任务描述附三次排查的证据链；第三步，在知识库建立「排查结论」索引页，后续同类问题先查索引再排查。风险点：三次结论如有互相矛盾之处，以最近一次为准并在文档中标注差异。',
  '## 交付物',
  '一份沉淀后的任务说明（含三次排查的证据链与根因对照表）、知识库排查索引页一份、执行记录一份。',
  '## 验收标准',
  '任务创建成功并进入执行会话；知识库索引页可检索到三次排查的根因关键词；后续同类问题可直接引用沉淀文档，不再重复排查；沉淀任务完成后原排查会话中留档回链，验收时三处均可核对。',
].join('\n')

async function publishSuggestions(...args: Parameters<typeof publishRegisteredSuggestions>) {
  const [context, input] = args
  registerAdvisorRound(input.roundId, { projectId: context.projectId!, advisorSessionId: context.sessionId!, triggerSessionId: context.sessionId! })
  return publishRegisteredSuggestions(...args)
}

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
    expect(config.advisorPrompt).toBe('')
    expect(config.defaultAdvisorPrompt).toBe(DEFAULT_ADVISOR_PROMPT)
    const session = sessionStore.get(config.sessionId!)
    expect(session).toMatchObject({ agent_id: advisor.id, project_id: project.id, purpose: 'advisor_runtime' })
    expect(session?.title).toBe('项目参谋会话')

    await expect(configureAdvisor(project.id, { advisorAgentId: 'agent-missing' })).rejects.toThrow('参谋 Agent 不存在')

    const other = projectStore.create({ name: 'Q', workDir: root })
    const foreign = agentStore.create({ type: 'dev', name: '外部执行者', runtime: 'mock', projectId: other.id })
    await expect(configureAdvisor(project.id, { advisorAgentId: foreign.id })).rejects.toThrow('不属于当前项目')
  })

  test('retains legacy runtime identity after rebuilding its configuration link', async () => {
    const { project, advisor, advisorSession, workerSession } = createFixture()
    projectAdvisorStore.update(project.id, { advisorAgentId: advisor.id, sessionId: advisorSession.id })
    const next = await rebuildAdvisorSession(project.id, advisor.id)
    expect(next.sessionId).not.toBe(advisorSession.id)
    expect(sessionStore.get(advisorSession.id)?.purpose).toBe('advisor_runtime')
    expect(sessionStore.get(next.sessionId!)?.purpose).toBe('advisor_runtime')
    expect(sessionStore.get(workerSession.id)?.purpose).toBe('conversation')
    expect(getDb().prepare('SELECT purpose FROM sessions WHERE id = ?').get(advisorSession.id))
      .toEqual({ purpose: 'advisor_runtime' })
  })

  test('batches sessions and publishes with the registered trigger and latest preferences', async () => {
    vi.useFakeTimers()
    const { project, advisor, executor, workerSession } = createFixture()
    const second = sessionStore.create({ agentId: executor.id, projectId: project.id })
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, advisorPrompt: '旧偏好' })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementation(async (_id, prompt) => {
      const roundId = /roundId = "([^"]+)"/.exec(prompt)![1]
      const result = await getHandler('suggestion.present')!.execute({
        roundId, suggestions: [suggestionPayload()],
      }, { projectId: project.id, sessionId: config.sessionId! })
      expect(result.isError).not.toBe(true)
    })
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'old'))
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'latest'))
    handleSessionTurnDone(turnDone(second.id, executor.id, 'second'))
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, advisorPrompt: '关注写作质量' })
    expect(enqueue).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [, prompt] = enqueue.mock.calls[0]!
    expect(prompt).toContain('关注写作质量')
    expect(prompt).not.toContain('旧偏好')
    expect(prompt).toContain(workerSession.id)
    expect(prompt).toContain(second.id)
    const [row] = advisorSuggestionStore.listAllByProject(project.id)
    expect(row.trigger_session_id).toBe(second.id)
    const late = await getHandler('suggestion.present')!.execute({
      roundId: row.round_id, suggestions: [suggestionPayload()],
    }, { projectId: project.id, sessionId: config.sessionId! })
    expect(late.isError).toBe(true)
  })

  test('filters stopped, disabled, autonomous and advisor turns without overwriting good events', async () => {
    vi.useFakeTimers()
    const { project, advisor, executor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: false })
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockResolvedValue(undefined)
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'disabled'))
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })
    const auto = sessionStore.create({ agentId: executor.id, projectId: project.id, purpose: 'autonomy' })
    handleSessionTurnDone(turnDone(auto.id, executor.id, 'auto'))
    handleSessionTurnDone(turnDone(config.sessionId!, advisor.id, 'self'))
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'good'))
    for (const stopReason of ['cancelled', 'error', 'max_tokens', undefined]) {
      handleSessionTurnDone({ ...turnDone(workerSession.id, executor.id, 'bad'), stopReason })
    }
    await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]![1]).toContain('事件 good')
    expect(enqueue.mock.calls[0]![1]).not.toContain('事件 bad')
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'next'))
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: false })
    await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  test('default remains a reference and clearing custom preferences really resets it', async () => {
    const { project, advisor } = createFixture()
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, advisorPrompt: '只关注文章' })
    await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: false })
    expect(projectAdvisorStore.get(project.id)?.advisor_prompt).toBe('只关注文章')
    const result = await configureAdvisor(project.id, { advisorAgentId: advisor.id, advisorPrompt: '' })
    expect(result.advisorPrompt).toBe('')
    expect(result.defaultAdvisorPrompt).toContain('写作')
    getAdvisorWorkspace(project.id)
    expect(projectAdvisorStore.get(project.id)?.advisor_prompt).toBe('')
  })

  test('rebuilding during analysis invalidates its round and preserves later work for the new session', async () => {
    vi.useFakeTimers()
    const { project, advisor, executor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id })
    let finish: () => void = () => undefined
    let roundId = ''
    const enqueue = vi.spyOn(sessionManager, 'enqueuePrompt').mockImplementationOnce(async (_id, prompt) => {
      roundId = /roundId = "([^"]+)"/.exec(prompt)![1]
      await new Promise<void>((resolvePromise) => { finish = resolvePromise })
    }).mockResolvedValue(undefined)
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'first'))
    await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
    // A real long analysis keeps ownership until completion, not a ten-minute TTL.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    await expect(publishRegisteredSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      { roundId, suggestions: [], noFindingReason: '无新增事项' },
    )).resolves.toMatchObject({ noFinding: true })
    const rebuilt = await rebuildAdvisorSession(project.id, advisor.id)
    handleSessionTurnDone(turnDone(config.sessionId!, advisor.id, 'old-advisor-completed'))
    await expect(publishRegisteredSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      { roundId, suggestions: [], noFindingReason: '迟到' },
    )).rejects.toThrow('不是项目参谋会话')
    handleSessionTurnDone(turnDone(workerSession.id, executor.id, 'second'))
    await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
    expect(enqueue).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(ADVISOR_BATCH_MS)
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue.mock.calls[1]![0]).toBe(rebuilt.sessionId)
    expect(enqueue.mock.calls[1]![1]).not.toContain('事件 old-advisor-completed')
  })

  test('publishing a round purges dead suggestions and their orphan artifacts (隔天清理)', async () => {
    const { project, advisor } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id, enabled: true })

    // 第一轮：plan 建议带产物落盘 + 注册预览
    const first = await publishSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      {
        roundId: 'round-dead',
        suggestions: [{
          type: 'plan',
          title: '过期方案',
          descriptionMarkdown: '## 背景\n这条建议将被判死并清理。\n## 目标\n验证惰性清理。',
          sourceEvidence: [],
          artifactName: '过期方案.html',
          artifactHtml: '<!doctype html><html><body><h1>dead</h1></body></html>',
        }],
      },
    )
    expect(first.stored).toBe(1)
    const [dead] = advisorSuggestionStore.listAllByProject(project.id)
    const artifact = JSON.parse(dead.artifact_json!) as { name: string; relativePath: string; previewId: string }
    const artifactPath = resolve(getDbPath()!, artifact.relativePath, artifact.name)
    expect(existsSync(artifactPath)).toBe(true)
    expect(previewStore.get(artifact.previewId)).toBeDefined()

    // 把它改成「过期超 24h」的死建议
    getDb().prepare('UPDATE advisor_suggestions SET expire_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), dead.id)

    // 第二轮产卡触发惰性清理（publishSuggestions 内部）
    await publishSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      { roundId: 'round-alive', suggestions: [], noFindingReason: '无增量建议' },
    )

    expect(advisorSuggestionStore.get(dead.id)).toBeUndefined()
    await waitUntil(() => !existsSync(artifactPath)) // unlink 异步，等待文件落删
    expect(previewStore.get(artifact.previewId)).toBeUndefined()
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

  test('push package lists project agents so the advisor picks real IDs', () => {
    const { project, executor, workerSession } = createFixture()
    agentStore.setHidden(agentStore.create({ type: 'dev', name: '已隐藏执行者', runtime: 'mock', projectId: project.id }).id, true)
    const { prompt } = buildAdvisorPushPrompt(project.id, turnDone(workerSession.id, executor.id, 'turn-agents'), '')

    expect(prompt).toContain('### 项目可用 Agent')
    expect(prompt).toContain('禁止编造 ID')
    expect(prompt).toContain(`${executor.id} · 执行者 · mock`)
    // 已隐藏 Agent 不进清单：列出来参谋选了也会被校验拒绝，只会误导
    expect(prompt).not.toContain('已隐藏执行者')
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

  test('rejects suggestions recommending agents outside the project (incl. global and hidden)', async () => {
    const { project, advisor } = createFixture()
    // 全局 Agent（project_id=null）：旧校验放行、前端项目过滤又排除，用户被迫手动重选——现在提交侧直接拒绝
    const globalAgent = agentStore.create({ type: 'dev', name: '全局执行者', runtime: 'mock', projectId: null })
    const hiddenAgent = agentStore.setHidden(agentStore.create({ type: 'dev', name: '隐藏执行者', runtime: 'mock', projectId: project.id }).id, true)
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id })

    await expect(publishSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      {
        roundId: 'round-global',
        suggestions: [suggestionPayload({ suggestedAgentId: globalAgent.id })],
      },
    )).rejects.toThrow('必须是当前项目内可用 Agent')

    await expect(publishSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      {
        roundId: 'round-hidden',
        suggestions: [suggestionPayload({ suggestedAgentId: hiddenAgent.id })],
      },
    )).rejects.toThrow('必须是当前项目内可用 Agent')
  })

  test('injects source session context into the created task description', async () => {
    const { project, executor, workerSession } = createFixture()
    messageStore.append(workerSession.id, { role: 'human', content: '服务启动报 EADDRINUSE 3000 端口被占' })
    messageStore.append(workerSession.id, { role: 'agent', content: '定位到是残留的 node 进程占用端口，根因是上次服务未正常退出。' })
    const [row] = advisorSuggestionStore.replaceRound(project.id, 'round-ctx', workerSession.id, [
      suggestionPayload({ suggestedAgentId: executor.id }),
    ])

    const view = await acceptSuggestion(project.id, row.id, { execute: false })
    const task = taskStore.get(view.settled.find((item) => item.id === row.id)!.task_id!)!
    expect(task.description).toContain('## 参谋分析依据（来源会话近期对话）')
    expect(task.description).toContain('【用户】服务启动报 EADDRINUSE')
    expect(task.description).toContain('【AI】定位到是残留的 node 进程')
    expect(task.description).toContain(`sessionId：${workerSession.id}`)
    expect(task.description).toContain('agent.session.messages')

    // 来源会话无消息时不加段，描述保持原样
    const emptySession = sessionStore.create({ agentId: executor.id, projectId: project.id })
    const [cleanRow] = advisorSuggestionStore.replaceRound(project.id, 'round-clean', emptySession.id, [
      suggestionPayload({ suggestedAgentId: executor.id, title: '无上下文建议' }),
    ])
    const cleanView = await acceptSuggestion(project.id, cleanRow.id, { execute: false })
    const cleanTask = taskStore.get(cleanView.settled.find((item) => item.id === cleanRow.id)!.task_id!)!
    expect(cleanTask.description).not.toContain('参谋分析依据')
    expect(cleanTask.description).toBe(cleanRow.description_markdown)
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
    expect(view.settled).toHaveLength(0)
    expect(advisorSuggestionStore.get(row.id)).toMatchObject({ id: row.id, status: 'ignored' })
  })

  test('exposes a default workspace and resumes stale dispatch tokens on startup', async () => {
    const { project, advisor, executor, workerSession } = createFixture()
    const workspace = getAdvisorWorkspace(project.id)
    expect(workspace.config.advisorPrompt).toBe('')
    expect(workspace.config.defaultAdvisorPrompt).toBe(DEFAULT_ADVISOR_PROMPT)
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

  test('accepts silence and rejects a round owned by another session or project', async () => {
    const { project, advisor, workerSession } = createFixture()
    const config = await configureAdvisor(project.id, { advisorAgentId: advisor.id })
    registerAdvisorRound('silence', { projectId: project.id, advisorSessionId: config.sessionId!, triggerSessionId: workerSession.id })
    await expect(publishRegisteredSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      { roundId: 'silence', suggestions: [], noFindingReason: '已有任务覆盖' },
    )).resolves.toMatchObject({ stored: 0, noFinding: true })
    registerAdvisorRound('foreign', { projectId: 'other', advisorSessionId: config.sessionId!, triggerSessionId: workerSession.id })
    await expect(publishRegisteredSuggestions(
      { projectId: project.id, sessionId: config.sessionId! },
      { roundId: 'foreign', suggestions: [], noFindingReason: '无' },
    )).rejects.toThrow('不属于当前会话')
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
