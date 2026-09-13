import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRuntimeStateSnapshot, resolveTeamInheritedProfileId } from '../../src/runtime/api/runtime-snapshot.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { teamMemberStore, teamStore } from '../../src/store/teams.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-team-runtime-config-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

interface Fixture {
  leaderMemberId: string
  leaderSessionId: string
  memberId: string
  memberSessionId: string
  leaderProfileId: string
  memberProfileId: string
}

/** Master 固定 leader-profile；成员 Agent 无自有档案；成员默认 inherit。 */
function setup(): Fixture {
  const project = projectStore.create({ name: 'project', workDir: tmp })
  const leaderProvider = modelProviderStore.create({
    name: 'leader-provider', displayName: 'leader-provider', protocol: 'claude', baseUrl: 'https://leader.example.com', apiKey: 'sk-leader',
  })
  const memberProvider = modelProviderStore.create({
    name: 'member-provider', displayName: 'member-provider', protocol: 'claude', baseUrl: 'https://member.example.com', apiKey: 'sk-member',
  })
  const leaderProfile = modelProfileStore.create({
    name: 'leader-profile', runtime: 'claude', providerId: leaderProvider.id, config: { defaultModel: 'leader-model' },
  })
  const memberProfile = modelProfileStore.create({
    name: 'member-profile', runtime: 'claude', providerId: memberProvider.id, config: { defaultModel: 'member-model' },
  })
  const team = teamStore.create({ projectId: project.id, name: '双人并行开发' })
  const leaderAgent = agentStore.create({ name: 'Master', type: 'coder', runtime: 'claude', projectId: project.id })
  const leaderSession = sessionStore.create({ agentId: leaderAgent.id, projectId: project.id })
  const leader = teamMemberStore.create({
    teamId: team.id, projectId: project.id, agentId: leaderAgent.id, sessionId: leaderSession.id,
    name: 'Master', role: 'leader', modelProfileId: leaderProfile.id, modelProfileMode: 'fixed',
  })
  const memberAgent = agentStore.create({ name: 'Dev-GLM', type: 'coder', runtime: 'claude', projectId: project.id, systemPrompt: '成员原始人设提示词' })
  const memberSession = sessionStore.create({ agentId: memberAgent.id, projectId: project.id })
  const member = teamMemberStore.create({
    teamId: team.id, projectId: project.id, agentId: memberAgent.id, sessionId: memberSession.id, name: 'Dev-GLM', role: 'member',
  })
  return { leaderMemberId: leader.id, leaderSessionId: leaderSession.id, memberId: member.id, memberSessionId: memberSession.id, leaderProfileId: leaderProfile.id, memberProfileId: memberProfile.id }
}

describe('team member runtime model resolution (execution layer mirrors the dock display)', () => {
  test('fixed mode applies the member profile', () => {
    const f = setup()
    teamMemberStore.updateConfig(f.memberId, { modelProfileMode: 'fixed', modelProfileId: f.memberProfileId })
    const snapshot = buildRuntimeStateSnapshot({ sessionId: f.memberSessionId })
    expect(snapshot.runtime.appliedModelProfile?.id).toBe(f.memberProfileId)
    expect(snapshot.runtime.appliedModelProfile?.modelId).toBe('member-model')
  })

  test('inherit mode applies the leader fixed profile', () => {
    const f = setup()
    const snapshot = buildRuntimeStateSnapshot({ sessionId: f.memberSessionId })
    expect(snapshot.runtime.appliedModelProfile?.id).toBe(f.leaderProfileId)
    expect(snapshot.runtime.appliedModelProfile?.modelId).toBe('leader-model')
  })

  test('inherit mode with a non-fixed leader follows the leader own agent chain', () => {
    const f = setup()
    const provider = modelProviderStore.list().find((item) => item.name === 'member-provider')!
    const agentProfile = modelProfileStore.create({
      name: 'leader-agent-profile', runtime: 'claude', providerId: provider.id, config: { defaultModel: 'leader-agent-model' },
    })
    const leaderAgentId = teamMemberStore.get(f.leaderMemberId)!.agent_id
    agentStore.update(leaderAgentId, { config: { modelProfileId: agentProfile.id } })
    teamMemberStore.updateConfig(f.leaderMemberId, { modelProfileMode: 'inherit', modelProfileId: null })

    const snapshot = buildRuntimeStateSnapshot({ sessionId: f.memberSessionId })
    expect(snapshot.runtime.appliedModelProfile?.id).toBe(agentProfile.id)
  })

  test('system mode ignores both the member profile and the master profile', () => {
    const f = setup()
    teamMemberStore.updateConfig(f.memberId, { modelProfileMode: 'system', modelProfileId: null })
    // 成员 Agent 与全局均无档案 → 不覆盖，按系统默认（无 appliedModelProfile）。
    expect(buildRuntimeStateSnapshot({ sessionId: f.memberSessionId }).runtime.appliedModelProfile).toBeUndefined()
    // 但成员 Agent 有自有档案时，system 模式走 Agent 原配置。
    const provider = modelProviderStore.list().find((item) => item.name === 'member-provider')!
    const agentProfile = modelProfileStore.create({
      name: 'member-agent-profile', runtime: 'claude', providerId: provider.id, config: { defaultModel: 'member-agent-model' },
    })
    const memberAgentId = teamMemberStore.get(f.memberId)!.agent_id
    agentStore.update(memberAgentId, { config: { modelProfileId: agentProfile.id } })
    expect(buildRuntimeStateSnapshot({ sessionId: f.memberSessionId }).runtime.appliedModelProfile?.id).toBe(agentProfile.id)
  })

  test('fixed mode falls back to the master chain when the member profile becomes unusable', () => {
    const f = setup()
    teamMemberStore.updateConfig(f.memberId, { modelProfileMode: 'fixed', modelProfileId: f.memberProfileId })
    modelProfileStore.update(f.memberProfileId, { enabled: false })
    expect(resolveTeamInheritedProfileId(teamMemberStore.get(f.memberId)!, 'claude')).toBe(f.leaderProfileId)
  })

  test('runtime-mismatched member profiles never resolve, matching the display chain', () => {
    const f = setup()
    const provider = modelProviderStore.list().find((item) => item.name === 'leader-provider')!
    const codexProfile = modelProfileStore.create({
      name: 'codex-profile', runtime: 'codex', providerId: provider.id, config: { model: 'codex-model' },
    })
    teamMemberStore.updateConfig(f.memberId, { modelProfileMode: 'fixed', modelProfileId: codexProfile.id })
    // 成员 Agent 运行时为 claude：codex 档案与运行时不匹配 → 跳过，回退 Master 档案（与展示链一致）。
    expect(resolveTeamInheritedProfileId(teamMemberStore.get(f.memberId)!, 'claude')).toBe(f.leaderProfileId)
  })
})

describe('team member system prompt override (next turn, team scoped)', () => {
  test('override replaces the member persona prompt without touching team/platform prompts', () => {
    const f = setup()
    teamMemberStore.updateConfig(f.memberId, { systemPromptOverride: '团队内只负责前端审查' })
    const meta = buildRuntimeStateSnapshot({ sessionId: f.memberSessionId }).runtime.sessionMeta
    const prompt = (meta?.systemPrompt as { append?: string } | undefined)?.append ?? ''
    expect(prompt).toContain('团队内只负责前端审查')
    expect(prompt).not.toContain('成员原始人设提示词')
  })

  test('blank override inherits the agent own prompt and the master stays unaffected', () => {
    const f = setup()
    const memberMeta = buildRuntimeStateSnapshot({ sessionId: f.memberSessionId }).runtime.sessionMeta
    const memberPrompt = (memberMeta?.systemPrompt as { append?: string } | undefined)?.append ?? ''
    expect(memberPrompt).toContain('成员原始人设提示词')

    teamMemberStore.updateConfig(f.memberId, { systemPromptOverride: '团队内只负责前端审查' })
    const leaderMeta = buildRuntimeStateSnapshot({ sessionId: f.leaderSessionId }).runtime.sessionMeta
    const leaderPrompt = (leaderMeta?.systemPrompt as { append?: string } | undefined)?.append ?? ''
    expect(leaderPrompt).not.toContain('团队内只负责前端审查')
  })
})
