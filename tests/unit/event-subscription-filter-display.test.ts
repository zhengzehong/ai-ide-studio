import { describe, expect, test } from 'vitest'
import { readableFilter } from '../../ui/src/pages/event-center/subscription-filter'

describe('event subscription filter display', () => {
  test('shows payload filter fields', () => {
    expect(readableFilter({
      payload: {
        taskStatus: 'backlog',
        assignedAgentId: null,
        changeType: { in: ['created', 'assigned'] },
      },
    })).toEqual([
      { label: 'Payload.taskStatus', value: 'backlog' },
      { label: 'Payload.assignedAgentId', value: 'null' },
      { label: 'Payload.changeType', value: 'in: created, assigned' },
    ])
  })
})
