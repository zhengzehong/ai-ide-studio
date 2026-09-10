import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRuntimeStateSnapshot } from '../../src/runtime/api/runtime-snapshot.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamMemberStore } from '../../src/store/teams.js'
import { teamService } from '../../src/core/teams.js'
import { spawnTeamMemberHandler } from '../../src/tools/handlers/team/team-tools.js'
import { TEAM_BUILTIN_TOOLS } from '../../src/tools/team-seed.js'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-model-profile-'))
  initDatabase(resolve(tempDir, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('team member model profile inheritance', () => {
  test('inherits the Master profile when a member override is not provided', () => {
    const project = projectStore.create({ name: 'Profile team', workDir: tempDir })
    const masterProfile = createClaudeProfile('master-model')
    const masterAgent = agentStore.create({
      name: 'Master',
      type: 'leader',
      runtime: 'claude',
      projectId: project.id,
      config: { modelProfileId: masterProfile.id, modelProfileMode: 'fixed' },
    })
    const masterSession = sessionStore.create({ agentId: masterAgent.id, projectId: project.id, isPrimary: true })
    const team = teamService.create({
      projectId: project.id,
      leaderAgentId: masterAgent.id,
      leaderSessionId: masterSession.id,
      name: 'Profile team',
    })
    const memberAgent = agentStore.create({ name: 'Member', type: 'developer', runtime: 'claude', projectId: project.id })
    const member = teamService.spawnMember({ teamId: team.team.id, agentId: memberAgent.id })

    expect(member.member.model_profile_id).toBeNull()
    expect(buildRuntimeStateSnapshot({ sessionId: member.session.id }).runtime.appliedModelProfile).toMatchObject({
      id: masterProfile.id,
      modelId: 'master-model',
    })
  })

  test('uses an explicit member profile without changing the Master or Agent profile', () => {
    const project = projectStore.create({ name: 'Override team', workDir: tempDir })
    const masterProfile = createClaudeProfile('master-model')
    const memberProfile = createClaudeProfile('member-model')
    const masterAgent = agentStore.create({
      name: 'Master',
      type: 'leader',
      runtime: 'claude',
      projectId: project.id,
      config: { modelProfileId: masterProfile.id, modelProfileMode: 'fixed' },
    })
    const masterSession = sessionStore.create({ agentId: masterAgent.id, projectId: project.id, isPrimary: true })
    const team = teamService.create({
      projectId: project.id,
      leaderAgentId: masterAgent.id,
      leaderSessionId: masterSession.id,
      name: 'Override team',
    })
    const memberAgent = agentStore.create({
      name: 'Member',
      type: 'developer',
      runtime: 'claude',
      projectId: project.id,
      config: { modelProfileId: masterProfile.id, modelProfileMode: 'fixed' },
    })
    const member = teamService.spawnMember({
      teamId: team.team.id,
      agentId: memberAgent.id,
      modelProfileId: memberProfile.id,
    })

    expect(member.member.model_profile_id).toBe(memberProfile.id)
    expect(buildRuntimeStateSnapshot({ sessionId: member.session.id }).runtime.appliedModelProfile).toMatchObject({
      id: memberProfile.id,
      modelId: 'member-model',
    })
    expect(JSON.parse(agentStore.get(memberAgent.id)?.config_json ?? '{}')).toMatchObject({
      modelProfileId: masterProfile.id,
    })
  })

  test('keeps the existing system fallback when neither side has a profile', () => {
    const project = projectStore.create({ name: 'Fallback team', workDir: tempDir })
    const masterAgent = agentStore.create({ name: 'Master', type: 'leader', runtime: 'claude', projectId: project.id })
    const masterSession = sessionStore.create({ agentId: masterAgent.id, projectId: project.id, isPrimary: true })
    const team = teamService.create({
      projectId: project.id,
      leaderAgentId: masterAgent.id,
      leaderSessionId: masterSession.id,
      name: 'Fallback team',
    })
    const memberAgent = agentStore.create({ name: 'Member', type: 'developer', runtime: 'claude', projectId: project.id })
    const member = teamService.spawnMember({ teamId: team.team.id, agentId: memberAgent.id })

    const snapshot = buildRuntimeStateSnapshot({ sessionId: member.session.id })
    expect(snapshot.runtime.appliedModelProfile).toBeUndefined()
  })

  test('rejects a missing or runtime-mismatched explicit profile', () => {
    const project = projectStore.create({ name: 'Validation team', workDir: tempDir })
    const masterAgent = agentStore.create({ name: 'Master', type: 'leader', runtime: 'claude', projectId: project.id })
    const masterSession = sessionStore.create({ agentId: masterAgent.id, projectId: project.id, isPrimary: true })
    const team = teamService.create({
      projectId: project.id,
      leaderAgentId: masterAgent.id,
      leaderSessionId: masterSession.id,
      name: 'Validation team',
    })
    const memberAgent = agentStore.create({ name: 'Member', type: 'developer', runtime: 'claude', projectId: project.id })
    const codexProfile = createCodexProfile()
    const agentCount = agentStore.list(project.id).length

    expect(() => teamService.spawnMember({ teamId: team.team.id, agentId: memberAgent.id, modelProfileId: 'missing-profile' }))
      .toThrow('模型档案不存在')
    expect(agentStore.list(project.id)).toHaveLength(agentCount)
    expect(() => teamService.spawnMember({ teamId: team.team.id, agentId: memberAgent.id, modelProfileId: codexProfile.id }))
      .toThrow('运行时与成员 Agent 运行时不匹配')
  })

  test('documents the lookup tool and exposes the member profile parameter', () => {
    expect(spawnTeamMemberHandler.description).toContain('core.model_profile.list')
    expect(spawnTeamMemberHandler.inputSchema.properties).toHaveProperty('modelProfileId')
    const definition = TEAM_BUILTIN_TOOLS.find((tool) => tool.name === 'team.member.spawn')
    expect(definition?.description).toContain('core.model_profile.list')
    expect(definition?.inputSchema).toMatchObject({ properties: { modelProfileId: expect.any(Object) } })
  })

  test('forwards modelProfileId from the team.member.spawn tool into the member binding', async () => {
    const project = projectStore.create({ name: 'Tool profile team', workDir: tempDir })
    const masterAgent = agentStore.create({ name: 'Master', type: 'leader', runtime: 'mock', projectId: project.id })
    const team = teamService.create({ projectId: project.id, leaderAgentId: masterAgent.id, name: 'Tool profile team' })
    const memberAgent = agentStore.create({ name: 'Member', type: 'developer', runtime: 'claude', projectId: project.id })
    const profile = createClaudeProfile('tool-member-model')

    const result = await spawnTeamMemberHandler.execute(
      { teamId: team.team.id, agentId: memberAgent.id, modelProfileId: profile.id },
      { projectId: project.id, agentId: team.agent.id, sessionId: team.session.id },
    )
    expect(result.isError).not.toBe(true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    const payload = JSON.parse(text) as { member?: { model_profile_id?: string | null } }
    expect(payload.member?.model_profile_id).toBe(profile.id)
  })
})

function createClaudeProfile(model: string) {
  const provider = modelProviderStore.create({
    name: `claude-${model}`,
    displayName: 'Claude provider',
    protocol: 'claude',
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
  })
  return modelProfileStore.create({
    name: model,
    runtime: 'claude',
    providerId: provider.id,
    config: { defaultModel: model },
  })
}

function createCodexProfile() {
  const provider = modelProviderStore.create({
    name: 'codex-profile',
    displayName: 'Codex provider',
    protocol: 'openai',
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
  })
  return modelProfileStore.create({
    name: 'codex-model',
    runtime: 'codex',
    providerId: provider.id,
    config: { model: 'codex-model' },
  })
}
