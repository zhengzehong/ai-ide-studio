import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore, messageStore } from '../../src/store/sessions.js'
import { projectAdvisorStore } from '../../src/store/advisors.js'
import { projectInspirationStore } from '../../src/store/project-inspirations.js'
import { projectSessionStatsStore } from '../../src/store/session-stats.js'
import { globalSessionDockStore } from '../../src/store/global-session-dock.js'
import { createDatabaseQueryPort } from '../../src/queries/database-query-port.js'
import { taskStore } from '../../src/store/tasks.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'background-session-visibility-'))
  initDatabase(resolve(root, 'test.sqlite'))
})
afterEach(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

test('legacy runtime links cannot leak through user lists, badges or dock', async () => {
  const project = projectStore.create({ name: 'Project' })
  const agent = agentStore.create({ name: 'Shared Agent', type: 'dev', runtime: 'mock', projectId: project.id })
  const task = taskStore.create({ title: 'User task', projectId: project.id })
  const user = sessionStore.create({ agentId: agent.id, projectId: project.id, taskId: task.id })
  const advisor = sessionStore.create({ agentId: agent.id, projectId: project.id })
  const inspiration = sessionStore.create({ agentId: agent.id, projectId: project.id })
  projectAdvisorStore.update(project.id, { sessionId: advisor.id, advisorAgentId: agent.id })
  projectInspirationStore.update(project.id, { sessionId: inspiration.id, organizerAgentId: agent.id })
  for (const session of [user, advisor, inspiration]) {
    messageStore.append(session.id, { role: 'agent', content: 'Completed output' })
    sessionStore.markRead(session.id, '2026-01-01T00:00:00.000Z')
    sessionStore.touch(session.id, '2026-01-02T00:00:00.000Z')
    globalSessionDockStore.add(session.id)
  }
  const port = createDatabaseQueryPort()
  expect((await port.listSessions({ projectId: project.id })).map((s) => s.id)).toEqual([user.id])
  expect((await port.listWidgetSessions({ projectId: project.id })).map((s) => s.sessionId)).toEqual([user.id])
  expect(globalSessionDockStore.listSummaries().map((s) => s.session_id)).toEqual([user.id])
  globalSessionDockStore.remove(user.id)
  expect(globalSessionDockStore.searchCandidates('', 30).map((s) => s.session_id)).toEqual([user.id])
  expect(projectSessionStatsStore.list(() => true)[0]).toMatchObject({ sessionCount: 1, runningCount: 1, unreadCount: 0 })
  expect(projectSessionStatsStore.list()[0]).toMatchObject({ sessionCount: 1, runningCount: 0, unreadCount: 1 })
  // Dedicated access must still work, including old conversation records.
  expect(sessionStore.get(advisor.id)?.purpose).toBe('advisor_runtime')
  expect(sessionStore.get(inspiration.id)?.purpose).toBe('inspiration_runtime')
  expect(messageStore.list(advisor.id)[0].content).toBe('Completed output')
  expect(getDb().prepare('SELECT purpose FROM sessions WHERE id = ?').get(advisor.id)).toEqual({ purpose: 'conversation' })
  for (const [agentId, projectId] of [[agent.id, project.id], [agent.id, undefined], [undefined, project.id], [undefined, undefined]]) {
    expect(sessionStore.list(agentId, projectId, { userVisibleOnly: true }).map((s) => s.id)).toEqual([user.id])
  }
  expect(sessionStore.reorder(project.id, agent.id, [user.id]).map((s) => s.id)).toEqual([user.id])
  expect(() => sessionStore.reorder(project.id, agent.id, [advisor.id])).toThrow('does not belong')
  expect(globalSessionDockStore.pruneUndockable()).toBe(2)
})

test('all background purposes and templates stay out while ordinary task sessions remain', async () => {
  const project = projectStore.create({ name: 'Project' })
  const agent = agentStore.create({ name: 'Agent', type: 'dev', runtime: 'mock', projectId: project.id })
  const user = sessionStore.create({ agentId: agent.id, projectId: project.id })
  for (const purpose of ['advisor_runtime', 'inspiration_runtime', 'secretary_chat', 'secretary_runtime', 'autonomy']) {
    const session = sessionStore.create({ agentId: agent.id, projectId: project.id })
    getDb().prepare('UPDATE sessions SET purpose = ? WHERE id = ?').run(purpose, session.id)
  }
  sessionStore.create({ agentId: agent.id, projectId: project.id, isTemplate: true })
  const port = createDatabaseQueryPort()
  expect((await port.listSessions({})).map((s) => s.id)).toEqual([user.id])
  expect((await port.listWidgetSessions({})).map((s) => s.sessionId)).toEqual([user.id])
  expect(projectSessionStatsStore.list()[0].sessionCount).toBe(1)
  expect(sessionStore.findAutonomyByAgent(agent.id)).toBeDefined()
})
