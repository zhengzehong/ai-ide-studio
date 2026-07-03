import { describe, expect, test } from 'vitest'
import { buildHubNaming } from '../../src/core/agent-hub/naming.js'

describe('agent-hub naming rules', () => {
  test('生成 instanceId / name / description / scopeKeys', () => {
    const result = buildHubNaming({
      agentId: 'agent-5f4f3b4b',
      agentName: '产品经理',
      agentDescription: '负责需求评审',
      machineId: 'mac-a1b2c3d4',
      sessionId: 'sess-8110acb9',
      projectId: 'proj-abc',
    })

    expect(result.instanceId).toBe('mac-a1b2c3d4-agent-5f4f3b4b-sess-8110acb9')
    expect(result.name).toBe('产品经理 · c3d4 · 8110ac')
    expect(result.description).toBe('负责需求评审 [mac-a1b2c3d4 · session 8110ac]')
    expect(result.scopeKeys).toEqual([
      'ai-ide-studio',
      'machine:mac-a1b2c3d4',
      'agent:agent-5f4f3b4b',
      'project:proj-abc',
    ])
  })

  test('没有 description 时回退到 agentName', () => {
    const result = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'Claude (开发)',
      agentDescription: '',
      machineId: 'mac-aaaaaaaa',
      sessionId: 'sess-1111111111',
    })
    expect(result.description).toBe('Claude (开发) [mac-aaaaaaaa · session 111111]')
  })

  test('没有 projectId 时不加 project scopeKey', () => {
    const result = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      agentDescription: 'desc',
      machineId: 'mac-aaaaaaaa',
      sessionId: 'sess-111',
      projectId: null,
    })
    expect(result.scopeKeys).toEqual([
      'ai-ide-studio',
      'machine:mac-aaaaaaaa',
      'agent:agent-1',
    ])
  })

  test('sessionId 不同时 name 后缀不同(跨 session 区分)', () => {
    const a = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      machineId: 'mac-aaaaaaaa',
      sessionId: 'sess-aaaa1111',
    })
    const b = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      machineId: 'mac-aaaaaaaa',
      sessionId: 'sess-bbbb2222',
    })
    expect(a.name).not.toBe(b.name)
    expect(a.instanceId).not.toBe(b.instanceId)
  })

  test('machineId 不同时 name 后 4 位不同(跨机器区分)', () => {
    const a = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      machineId: 'mac-aaa1111a',
      sessionId: 'sess-1',
    })
    const b = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      machineId: 'mac-bbb2222b',
      sessionId: 'sess-1',
    })
    expect(a.name).not.toBe(b.name)
  })
})
