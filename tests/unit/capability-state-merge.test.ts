import { describe, test, expect } from 'vitest'
import { mergeCapabilities, type SessionCapabilities } from '../../ui/src/stores/session-events.ts'

describe('mergeCapabilities', () => {
  test('用初始能力补全事件还原中的空字段', () => {
    const current: SessionCapabilities = {
      models: [{ modelId: 'm-1', name: '模型一' }],
      currentModelId: 'm-1',
      modes: [{ modeId: 'plan', name: '计划模式' }],
      currentModeId: 'plan',
      supportsImages: true,
      supportsAudio: true,
      configOptions: [{ id: 'model', name: '模型', category: 'model', type: 'select', currentValue: 'm-1', options: [{ value: 'm-1', name: '模型一' }] }],
      commands: [{ name: 'review', description: '代码审查', input: null }],
      sessionInfo: { title: '原会话' },
    }

    const reducedFromEvents: SessionCapabilities = {
      models: [],
      currentModelId: null,
      modes: [],
      currentModeId: null,
      supportsImages: false,
      supportsAudio: false,
      configOptions: [{ id: 'effort', name: '思考强度', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high', name: '高' }] }],
      commands: [],
    }

    const merged = mergeCapabilities(current, reducedFromEvents)
    expect(merged.currentModelId).toBe('m-1')
    expect(merged.models[0].name).toBe('模型一')
    expect(merged.currentModeId).toBe('plan')
    expect(merged.supportsImages).toBe(true)
    expect(merged.supportsAudio).toBe(true)
    expect(merged.commands[0].name).toBe('review')
    expect(merged.sessionInfo?.title).toBe('原会话')
    expect(merged.configOptions.some(o => o.id === 'model')).toBe(true)
    expect(merged.configOptions.some(o => o.id === 'effort')).toBe(true)
  })
})
