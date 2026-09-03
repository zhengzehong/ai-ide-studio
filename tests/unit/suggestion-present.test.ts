import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDbPath, initDatabase } from '../../src/store/db.js'
import { advisorSuggestionStore } from '../../src/store/advisor-suggestions.js'
import { agentStore } from '../../src/store/agents.js'
import { projectAdvisorStore } from '../../src/store/advisors.js'
import { previewStore } from '../../src/store/previews.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-suggestion-present-'))
let index = 0

beforeEach(() => {
  closeDatabase()
  const dir = resolve(root, `case-${++index}`)
  mkdirSync(dir, { recursive: true })
  initDatabase(resolve(dir, 'test.sqlite'))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

function createFixture() {
  const project = projectStore.create({ name: 'P', workDir: root })
  const advisor = agentStore.create({ type: 'pm', name: '参谋', runtime: 'mock', projectId: project.id })
  const advisorSession = sessionStore.create({ agentId: advisor.id, projectId: project.id })
  projectAdvisorStore.update(project.id, {
    advisorAgentId: advisor.id,
    sessionId: advisorSession.id,
    enabled: true,
  })
  const executor = agentStore.create({ type: 'dev', name: '执行者', runtime: 'mock', projectId: project.id })
  const context: ToolContext = { projectId: project.id, sessionId: advisorSession.id }
  return { project, advisor, advisorSession, executor, context }
}

const LONG_DESCRIPTION = [
  '## 背景',
  '用户反馈列表页打开明显变慢，长列表渲染时页面出现长时间白屏，怀疑是每行组件重复创建导致的性能瓶颈。',
  '## 目标',
  '定位首屏渲染瓶颈，拆分长列表为虚拟滚动渲染，减少不必要的重复提交与重排。',
  '## 交付物',
  '改造后的列表组件与性能对比数据。',
  '## 验收标准',
  '同样数据量下首屏时间下降一半，滚动帧率稳定在 60 帧。',
].join('\n')

function actionSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    type: 'action',
    title: '优化列表页首屏渲染',
    descriptionMarkdown: LONG_DESCRIPTION,
    sourceEvidence: [{ sessionId: 'sess-1', title: '性能排查会话' }],
    suggestedAgentId: null,
    ...overrides,
  }
}

function planSuggestion(overrides: Record<string, unknown> = {}) {
  return actionSuggestion({
    type: 'plan',
    title: '列表页性能重构方案',
    artifactName: '列表页性能重构方案.html',
    artifactHtml: '<!doctype html><html><body><h1>方案</h1></body></html>',
    ...overrides,
  })
}

async function execute(handlerInput: Record<string, unknown>, context: ToolContext): Promise<ToolHandlerResult> {
  return getHandler('suggestion.present')!.execute(handlerInput, context)
}

describe('suggestion.present tool', () => {
  test('stores action suggestions from the advisor session', async () => {
    const { project, executor, context } = createFixture()

    const result = await execute({
      roundId: 'advisor-turn-1',
      suggestions: [actionSuggestion({ suggestedAgentId: executor.id, agentReason: '前端性能擅长' })],
    }, context)

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0]!.text as string)).toEqual({
      kind: 'advisor-suggestions-stored',
      roundId: 'advisor-turn-1',
      stored: 1,
      noFinding: false,
    })
    const [row] = advisorSuggestionStore.listAllByProject(project.id)
    expect(row).toMatchObject({
      round_id: 'advisor-turn-1',
      type: 'action',
      title: '优化列表页首屏渲染',
      status: 'pending',
      suggested_agent_id: executor.id,
      agent_reason: '前端性能擅长',
    })
    expect(JSON.parse(row.source_evidence_json)).toEqual([{ sessionId: 'sess-1', title: '性能排查会话' }])
    expect(advisorSuggestionStore.countPending(project.id)).toBe(1)
  })

  test('persists plan artifacts to disk and registers a preview', async () => {
    const { project, context } = createFixture()

    const result = await execute({
      roundId: 'advisor-turn-plan',
      suggestions: [planSuggestion()],
    }, context)

    expect(result.isError).not.toBe(true)
    const [row] = advisorSuggestionStore.listAllByProject(project.id)
    const artifact = JSON.parse(row.artifact_json!)
    expect(artifact.name).toMatch(/^suggestion-[0-9a-f]+-列表页性能重构方案\.html$/)
    expect(artifact.relativePath).toBe(`advisor-artifacts/${project.id}`)
    expect(artifact.size).toBeGreaterThan(0)

    const absolutePath = resolve(getDbPath()!, artifact.relativePath, artifact.name)
    expect(existsSync(absolutePath)).toBe(true)
    expect(readFileSync(absolutePath, 'utf8')).toContain('<h1>方案</h1>')

    const preview = previewStore.get(artifact.previewId)
    expect(preview).toMatchObject({ project_id: project.id, title: '列表页性能重构方案.html', target: 'pc' })
  })

  test('stores an empty round as silence with a reason and emits no suggestions', async () => {
    const { project, context } = createFixture()

    const result = await execute({
      roundId: 'advisor-turn-empty',
      suggestions: [],
      noFindingReason: '本轮是常规问答，没有值得建议的改动',
    }, context)

    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0]!.text as string)).toMatchObject({ stored: 0, noFinding: true })
    expect(advisorSuggestionStore.listAllByProject(project.id)).toHaveLength(0)
  })

  test('rejects a non-advisor session and a missing reason for empty rounds', async () => {
    const { project, advisor, context } = createFixture()
    const outsider = sessionStore.create({ agentId: advisor.id, projectId: project.id })
    const outsiderContext: ToolContext = { projectId: project.id, sessionId: outsider.id }

    const rejected = await execute({ roundId: 'r1', suggestions: [actionSuggestion()] }, outsiderContext)
    expect(rejected.isError).toBe(true)
    expect(rejected.content[0]!.text).toContain('不是项目参谋会话')

    const noReason = await execute({ roundId: 'r2', suggestions: [] }, context)
    expect(noReason.isError).toBe(true)
    expect(noReason.content[0]!.text).toContain('noFindingReason')

    const missingContext = await execute({ roundId: 'r3', suggestions: [] }, {})
    expect(missingContext.isError).toBe(true)
  })

  test('rejects placeholder descriptions, oversized batches, and broken plan payloads', async () => {
    const { executor, context } = createFixture()

    const placeholder = await execute({
      roundId: 'r1',
      suggestions: [actionSuggestion({ descriptionMarkdown: '太短' })],
    }, context)
    expect(placeholder.isError).toBe(true)
    expect(placeholder.content[0]!.text).toContain('至少 80')

    const tooMany = await execute({
      roundId: 'r2',
      suggestions: [1, 2, 3, 4].map((n) => actionSuggestion({ title: `建议${n}` })),
    }, context)
    expect(tooMany.isError).toBe(true)
    expect(tooMany.content[0]!.text).toContain('最多 3')

    const planWithoutArtifact = await execute({
      roundId: 'r3',
      suggestions: [planSuggestion({ artifactHtml: undefined })],
    }, context)
    expect(planWithoutArtifact.isError).toBe(true)
    expect(planWithoutArtifact.content[0]!.text).toContain('artifactName 和 artifactHtml')

    const foreignAgent = await execute({
      roundId: 'r4',
      suggestions: [actionSuggestion({ suggestedAgentId: 'agent-not-in-project' })],
    }, context)
    expect(foreignAgent.isError).toBe(true)
    expect(foreignAgent.content[0]!.text).toContain('不属于当前项目')

    const unknownType = await execute({
      roundId: 'r5',
      suggestions: [actionSuggestion({ type: 'note' })],
    }, context)
    expect(unknownType.isError).toBe(true)
    expect(unknownType.content[0]!.text).toContain('plan 或 action')
  })

  test('overwrites suggestions within the same round and keeps other rounds', async () => {
    const { project, context } = createFixture()
    const executor = agentStore.create({ type: 'dev', name: '另一个执行者', runtime: 'mock', projectId: project.id })

    await execute({ roundId: 'round-a', suggestions: [actionSuggestion()] }, context)
    await execute({ roundId: 'round-a', suggestions: [actionSuggestion({ title: '修订后的建议' })] }, context)
    await execute({ roundId: 'round-b', suggestions: [actionSuggestion({ title: '另一轮的建议', suggestedAgentId: executor.id })] }, context)

    const all = advisorSuggestionStore.listAllByProject(project.id)
    expect(all).toHaveLength(2)
    const roundA = all.filter((row) => row.round_id === 'round-a')
    expect(roundA).toHaveLength(1)
    expect(roundA[0].title).toBe('修订后的建议')
    expect(all.find((row) => row.round_id === 'round-b')?.title).toBe('另一轮的建议')
  })
})
