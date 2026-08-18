import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { getHandler } from '../../src/tools/handlers/index.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'secretary-management-tools-'))
  initDatabase(resolve(root, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('secretary management tools', () => {
  test('manages only the current project and requires an exact name for deletion', async () => {
    const project = projectStore.create({ name: 'Current', workDir: root })
    const agent = agentStore.create({ name: 'PM', type: 'pm', runtime: 'mock', projectId: project.id })
    const context = { projectId: project.id, agentId: agent.id, sessionId: 'conversation-1', workDir: root }
    const create = requireHandler('studio.secretary.create')
    const created = parseResult<Record<string, unknown>>(await create.execute({
      projectId: 'project-spoofed',
      name: 'Daily digest',
      executionAgentId: agent.id,
      definitionPrompt: 'Summarize project changes',
      reportPrompt: 'Use concise Markdown',
      observeAll: true,
      cron: '30 18 * * *',
      watchSessionDone: false,
    }, context))

    expect(created).toMatchObject({ name: 'Daily digest', projectId: project.id, chatUnread: false })
    const secretaryId = String(created.id)

    const listed = parseResult<unknown[]>(await requireHandler('studio.secretary.list').execute({}, context))
    expect(listed).toHaveLength(1)
    expect(parseResult<Record<string, unknown>>(await requireHandler('studio.secretary.get').execute({ secretaryId }, context)))
      .toMatchObject({ id: secretaryId, projectId: project.id })

    expect(parseResult<Record<string, unknown>>(await requireHandler('studio.secretary.update').execute({
      secretaryId,
      name: 'Delivery digest',
      enabled: false,
    }, context))).toMatchObject({ id: secretaryId, name: 'Delivery digest', enabled: false })

    await expect(requireHandler('studio.secretary.delete').execute({
      secretaryId,
      name: 'Daily digest',
    }, context)).rejects.toThrow('name')
    expect(parseResult<Record<string, unknown>>(await requireHandler('studio.secretary.delete').execute({
      secretaryId,
      name: 'Delivery digest',
    }, context))).toEqual({ deleted: true, secretaryId })
  })

  test('does not accept an execution Agent from another project', async () => {
    const project = projectStore.create({ name: 'Current', workDir: root })
    const other = projectStore.create({ name: 'Other', workDir: root })
    const caller = agentStore.create({ name: 'Caller', type: 'pm', runtime: 'mock', projectId: project.id })
    const foreignAgent = agentStore.create({ name: 'Foreign', type: 'pm', runtime: 'mock', projectId: other.id })

    await expect(requireHandler('studio.secretary.create').execute({
      name: 'Foreign secretary',
      executionAgentId: foreignAgent.id,
    }, { projectId: project.id, agentId: caller.id, sessionId: 'conversation-1', workDir: root }))
      .rejects.toThrow()
  })
})

function requireHandler(name: string) {
  const handler = getHandler(name)
  if (!handler) throw new Error(`Missing handler: ${name}`)
  return handler
}

function parseResult<T>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(result.content[0].text) as T
}
