import { describe, expect, test } from 'vitest'
import { buildHubNaming } from '../../src/core/agent-hub/naming.js'

describe('agent-hub naming rules', () => {
  test('生成 instanceId / name / description / scopeKeys(无 machineLabel,回退到 machineShort)', () => {
    const result = buildHubNaming({
      agentId: 'agent-5f4f3b4b',
      agentName: '产品经理',
      agentDescription: '负责需求评审',
      machineId: 'mac-a1b2c3d4',
      machineLabel: undefined,
      sessionId: 'sess-8110acb9',
      projectId: 'proj-abc',
    })

    expect(result.instanceId).toBe('mac-a1b2c3d4-agent-5f4f3b4b-sess-8110acb9')
    expect(result.name).toBe('产品经理 · c3d4 · 8110ac')
    expect(result.description).toBe('负责需求评审 [c3d4 · session 8110ac]')
    expect(result.scopeKeys).toEqual([
      'ai-ide-studio',
      'machine:mac-a1b2c3d4',
      'machine-label:c3d4',
      'agent:agent-5f4f3b4b',
      'project:proj-abc',
    ])
  })

  test('有 machineLabel 时使用 label 替代 machineShort', () => {
    const result = buildHubNaming({
      agentId: 'agent-5f4f3b4b',
      agentName: '产品经理',
      agentDescription: '负责需求评审',
      machineId: 'mac-a1b2c3d4',
      machineLabel: '公司Mac',
      sessionId: 'sess-8110acb9',
      projectId: 'proj-abc',
    })

    expect(result.name).toBe('产品经理 · 公司Mac · 8110ac')
    expect(result.description).toBe('负责需求评审 [公司Mac · session 8110ac]')
    expect(result.scopeKeys).toEqual([
      'ai-ide-studio',
      'machine:mac-a1b2c3d4',
      'machine-label:公司Mac',
      'agent:agent-5f4f3b4b',
      'project:proj-abc',
    ])
  })

  test('scopeKeys 含 machine-label:${label} (无 machineLabel 时用 machineShort)', () => {
    const result = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      agentDescription: 'desc',
      machineId: 'mac-aaaaaaaa',
      sessionId: 'sess-111',
      projectId: null,
    })
    expect(result.scopeKeys).toContain('machine-label:aaaa')
    expect(result.scopeKeys).toContain('machine:mac-aaaaaaaa')
  })

  test('没有 description 时回退到 agentName', () => {
    const result = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'Claude (开发)',
      agentDescription: '',
      machineId: 'mac-aaaaaaaa',
      sessionId: 'sess-1111111111',
    })
    expect(result.description).toBe('Claude (开发) [aaaa · session 111111]')
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
      'machine-label:aaaa',
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

  test('machineId 不同且无 machineLabel 时 name 后 4 位不同(跨机器区分)', () => {
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

  test('有 machineLabel 时不同 label 的 name 不同(跨机器区分)', () => {
    const a = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      machineId: 'mac-aaa1111a',
      machineLabel: '公司Mac',
      sessionId: 'sess-1',
    })
    const b = buildHubNaming({
      agentId: 'agent-1',
      agentName: 'A',
      machineId: 'mac-bbb2222b',
      machineLabel: '家里PC',
      sessionId: 'sess-1',
    })
    expect(a.name).not.toBe(b.name)
  })
})
