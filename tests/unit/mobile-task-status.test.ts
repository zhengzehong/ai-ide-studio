import { expect, test } from 'vitest'
import { mobileTaskStatusMeta } from '../../mobile/src/pages/TaskListPage'
import type { TaskStatus } from '../../src/types/ws-protocol'

test('mobile task status labels cover backend task statuses', () => {
  const cases: Array<[TaskStatus, string]> = [
    ['backlog', '待办'],
    ['executing', '执行中'],
    ['needs_input', '需输入'],
    ['blocked', '受阻'],
    ['reviewing', '待确认'],
    ['completed', '已完成'],
    ['cancelled', '已取消'],
  ]

  for (const [status, label] of cases) {
    expect(mobileTaskStatusMeta(status).label).toBe(label)
  }
})
