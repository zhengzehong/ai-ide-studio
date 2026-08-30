import { describe, expect, test } from 'vitest'
import {
  batchDeletableSessionIds,
  toggleBatchSessionSelection,
  type BatchSessionItem,
} from '../../ui/src/pages/workspace/session-bulk-selection'

const sessions: BatchSessionItem[] = [
  { id: 'primary', isPrimary: true, isRunning: false, isCurrent: false },
  { id: 'running', isPrimary: false, isRunning: true, isCurrent: false },
  { id: 'current', isPrimary: false, isRunning: false, isCurrent: true },
  { id: 'idle', isPrimary: false, isRunning: false, isCurrent: false },
]

describe('SessionBar batch selection', () => {
  test('select all only includes deletable sessions', () => {
    expect(batchDeletableSessionIds(sessions)).toEqual(['idle'])
  })

  test('toggles one session without selecting protected sessions', () => {
    expect(toggleBatchSessionSelection([], sessions[0]!)).toEqual([])
    expect(toggleBatchSessionSelection([], sessions[3]!)).toEqual(['idle'])
    expect(toggleBatchSessionSelection(['idle'], sessions[3]!)).toEqual([])
  })
})
