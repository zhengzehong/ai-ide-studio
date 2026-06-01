import * as acp from '@agentclientprotocol/sdk'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { agentStore } from '../../src/store/agents.js'
import { projectStore } from '../../src/store/projects.js'
import { toolBindingStore, toolStore } from '../../src/store/tools.js'
import { teamService } from '../../src/core/teams.js'
import { seedBuiltinTools } from '../../src/tools/seed.js'
import { resolveAutoPermission } from '../../src/acp/auto-permission.js'
import type { ToolPermissions } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-acp-permission-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  seedBuiltinTools()
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('ACP Team auto permission', () => {
  test('auto-approves visible internal Team mailbox tool without approval requirement', () => {
    const { worker, session } = createTeamMember()

    const result = resolveAutoPermission({
      agentId: worker.id,
      ourSessionId: session.id,
      toolCall: toolCall('mcp__ai-ide-tools__team_mailbox_send'),
      options: allowOptions(),
    })

    expect(result).toEqual({ outcome: { outcome: 'selected', optionId: 'always' } })
  })

  test('rejects external MCP tools even when the normalized tool name matches', () => {
    const { worker, session } = createTeamMember()

    const result = resolveAutoPermission({
      agentId: worker.id,
      ourSessionId: session.id,
      toolCall: toolCall('mcp__external-tools__team_mailbox_send'),
      options: allowOptions(),
    })

    expect(result).toBeUndefined()
  })

  test('rejects hidden Team tools', () => {
    const { worker, session } = createTeamMember()
    const mailbox = requiredTool('team.mailbox.send')
    toolBindingStore.setEnabled(mailbox.id, 'agent', worker.id, false)

    const result = resolveAutoPermission({
      agentId: worker.id,
      ourSessionId: session.id,
      toolCall: toolCall('mcp__ai-ide-tools__team_mailbox_send'),
      options: allowOptions(),
    })

    expect(result).toBeUndefined()
  })

  test('rejects Team tools that require explicit approval', () => {
    const { worker, session } = createTeamMember()
    const mailbox = requiredTool('team.mailbox.send')
    const permissions = JSON.parse(mailbox.permissions_json) as ToolPermissions
    toolStore.update(mailbox.id, { permissions: { ...permissions, requiresApproval: true } })

    const result = resolveAutoPermission({
      agentId: worker.id,
      ourSessionId: session.id,
      toolCall: toolCall('mcp__ai-ide-tools__team_mailbox_send'),
      options: allowOptions(),
    })

    expect(result).toBeUndefined()
  })
})

function createTeamMember() {
  const project = projectStore.create({ name: 'P', workDir: tmp })
  const leader = agentStore.create({ name: 'Leader', type: 'architect', runtime: 'mock', projectId: project.id })
  const worker = agentStore.create({ name: 'Worker', type: 'dev', runtime: 'mock', projectId: project.id })
  const created = teamService.create({ projectId: project.id, leaderAgentId: leader.id, name: 'Alpha' })
  const spawned = teamService.spawnMember({ teamId: created.team.id, agentId: worker.id })
  return { project, worker, session: spawned.session }
}

function toolCall(title: string): acp.ToolCallUpdate {
  return { toolCallId: 'tool-call-1', title }
}

function allowOptions(): acp.PermissionOption[] {
  return [
    { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
  ]
}

function requiredTool(name: string) {
  const tool = toolStore.getByName(name)
  if (!tool) throw new Error(`missing tool: ${name}`)
  return tool
}
