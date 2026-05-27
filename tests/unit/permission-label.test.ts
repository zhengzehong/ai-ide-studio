import { describe, expect, test } from 'vitest'
import { permissionOptionLabel } from '../../ui/src/utils/permission.ts'

describe('permission option labels', () => {
  test('用短中文文案替代 ACP 原始长按钮', () => {
    expect(permissionOptionLabel({ optionId: 'allow_always', name: 'Always Allow Bash(...)', kind: 'allow_always' })).toBe('始终允许')
    expect(permissionOptionLabel({ optionId: 'allow', name: 'Allow once', kind: 'allow_once' })).toBe('允许一次')
    expect(permissionOptionLabel({ optionId: 'reject', name: 'Reject', kind: 'reject_once' })).toBe('拒绝')
    expect(permissionOptionLabel({ optionId: 'never', name: 'Never Allow', kind: 'reject_always' })).toBe('始终拒绝')
  })
})
