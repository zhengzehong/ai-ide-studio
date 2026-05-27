import { describe, test, expect } from 'vitest'
import { capabilitiesFromConfig } from '../../ui/src/stores/session-events.ts'

describe('capabilitiesFromConfig', () => {
  test('合并 configOptions 时保留其他能力字段', () => {
    const current = {
      models: [{ modelId: 'm-1', name: '模型一' }],
      currentModelId: 'm-1',
      modes: [{ modeId: 'plan', name: '计划模式' }],
      currentModeId: 'plan',
      supportsImages: true,
      supportsAudio: true,
      commands: [{ name: 'review', description: '代码审查', input: null }],
      configOptions: [{ id: 'model', name: '模型', category: 'model', type: 'select', currentValue: 'm-1', options: [{ value: 'm-1', name: '模型一' }] }],
      sessionInfo: { title: '原会话' },
    }

    const next = capabilitiesFromConfig(current, [
      { id: 'effort', name: '思考强度', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high', name: '高' }] },
    ])

    expect(next.currentModelId).toBe('m-1')
    expect(next.models[0].name).toBe('模型一')
    expect(next.currentModeId).toBe('plan')
    expect(next.modes[0].name).toBe('计划模式')
    expect(next.supportsImages).toBe(true)
    expect(next.supportsAudio).toBe(true)
    expect(next.commands[0].name).toBe('review')
    expect(next.configOptions).toHaveLength(2)
    expect(next.configOptions.some(o => o.id === 'model')).toBe(true)
    expect(next.configOptions.some(o => o.id === 'effort')).toBe(true)
  })
})
