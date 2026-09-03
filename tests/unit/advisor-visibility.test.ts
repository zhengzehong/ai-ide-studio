import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectAdvisorStore } from '../../src/store/advisors.js'
import { projectInspirationStore } from '../../src/store/project-inspirations.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { isToolVisibleForSession } from '../../src/tools/session-tool-visibility.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-advisor-visibility-'))
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
  return { project, advisor, advisorSession }
}

describe('advisor session tool visibility', () => {
  test('exposes suggestion.present only to the advisor session', () => {
    const { project, advisor, advisorSession } = createFixture()
    const ordinarySession = sessionStore.create({ agentId: advisor.id, projectId: project.id })

    expect(isToolVisibleForSession('suggestion.present', advisorSession.id)).toBe(true)
    expect(isToolVisibleForSession('suggestion.present', ordinarySession.id)).toBe(false)
    expect(isToolVisibleForSession('suggestion.present')).toBe(false)
  })

  test('keeps history-reading tools available and blocks task creation tools in the advisor session', () => {
    const { advisorSession } = createFixture()

    // A-3：参谋翻历史的手脚不被屏蔽
    expect(isToolVisibleForSession('agent.session.messages', advisorSession.id)).toBe(true)
    expect(isToolVisibleForSession('agent.session.list', advisorSession.id)).toBe(true)
    // A-2：参谋不得自行创建/派发任务或改排期
    expect(isToolVisibleForSession('studio.task.createSimple', advisorSession.id)).toBe(false)
    expect(isToolVisibleForSession('studio.task.create', advisorSession.id)).toBe(false)
    expect(isToolVisibleForSession('studio.task.assign', advisorSession.id)).toBe(false)
    expect(isToolVisibleForSession('studio.schedule.create', advisorSession.id)).toBe(false)
  })

  test('keeps inspiration tool boundaries unaffected by advisor configuration', () => {
    const { project, advisor, advisorSession } = createFixture()

    // 参谋会话不因参谋身份拿到灵感专属工具
    expect(isToolVisibleForSession('inspiration.analysis.publish', advisorSession.id)).toBe(false)
    expect(isToolVisibleForSession('suggestion.present', advisorSession.id)).toBe(true)

    // 灵感会话也不因同 Agent 拿到 suggestion.present
    projectInspirationStore.update(project.id, { organizerAgentId: advisor.id, sessionId: advisorSession.id })
    // 灵感会话换成独立会话
    const inspirationSession = sessionStore.create({ agentId: advisor.id, projectId: project.id })
    projectInspirationStore.update(project.id, { sessionId: inspirationSession.id })
    expect(isToolVisibleForSession('inspiration.analysis.publish', inspirationSession.id)).toBe(true)
    expect(isToolVisibleForSession('suggestion.present', inspirationSession.id)).toBe(false)
  })

  test('stops exposing advisor tools once the session binding is replaced', () => {
    const { project, advisor, advisorSession } = createFixture()
    expect(isToolVisibleForSession('suggestion.present', advisorSession.id)).toBe(true)

    const nextAdvisor = agentStore.create({ type: 'pm', name: '新参谋', runtime: 'mock', projectId: project.id })
    const nextSession = sessionStore.create({ agentId: nextAdvisor.id, projectId: project.id })
    projectAdvisorStore.update(project.id, { advisorAgentId: nextAdvisor.id, sessionId: nextSession.id })

    expect(isToolVisibleForSession('suggestion.present', advisorSession.id)).toBe(false)
    expect(isToolVisibleForSession('suggestion.present', nextSession.id)).toBe(true)
  })
})
