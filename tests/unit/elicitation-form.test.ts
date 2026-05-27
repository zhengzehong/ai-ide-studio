import { describe, expect, test } from 'vitest'
import { getElicitationOptions, getInitialElicitationValues, validateElicitationValues } from '../../ui/src/utils/elicitation-form.ts'

describe('elicitation form helpers', () => {
  test('初始化 string/number/boolean/array 默认值', () => {
    const values = getInitialElicitationValues({
      type: 'object',
      properties: {
        name: { type: 'string', default: '张三' },
        count: { type: 'number', default: 2 },
        enabled: { type: 'boolean', default: true },
        tags: { type: 'array', default: ['a'], items: { type: 'string', enum: ['a', 'b'] } },
      },
    })

    expect(values).toEqual({ name: '张三', count: 2, enabled: true, tags: ['a'] })
  })

  test('校验 required 字段和 array minItems', () => {
    const result = validateElicitationValues(
      {
        type: 'object',
        required: ['name', 'tags'],
        properties: {
          name: { type: 'string', title: '名称' },
          tags: { type: 'array', title: '标签', minItems: 1, items: { type: 'string', enum: ['a', 'b'] } },
        },
      },
      { name: '', tags: [] },
    )

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual({ name: '请填写名称', tags: '请至少选择 1 项' })
  })

  test('读取单选 oneOf 与多选 anyOf 选项', () => {
    expect(getElicitationOptions({ type: 'string', oneOf: [{ const: 'safe', title: '安全' }] })).toEqual([
      { value: 'safe', label: '安全' },
    ])
    expect(getElicitationOptions({ type: 'array', items: { anyOf: [{ const: 'read', title: '读取' }] } })).toEqual([
      { value: 'read', label: '读取' },
    ])
  })
})
