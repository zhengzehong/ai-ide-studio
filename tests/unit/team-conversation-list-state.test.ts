import { describe, expect, it } from 'vitest'
import { isTeamConversationRunning } from '../../ui/src/components/team/team-conversation-state'

describe('team conversation running indicator', () => {
  const conversation = { master_session_id: 'master-1', activity_state: null as 'running' | 'idle' | null }

  it('does not treat an active unarchived conversation as running', () => {
    expect(isTeamConversationRunning(conversation, {})).toBe(false)
  })

  it('uses the live running session map for the master session', () => {
    expect(isTeamConversationRunning(conversation, { 'master-1': true })).toBe(true)
  })

  it('uses persisted activity_state when the live map is not populated', () => {
    expect(isTeamConversationRunning({ ...conversation, activity_state: 'running' }, {})).toBe(true)
    expect(isTeamConversationRunning({ ...conversation, activity_state: 'idle' }, {})).toBe(false)
  })

  it('supports activity state supplied by the session store', () => {
    expect(isTeamConversationRunning(conversation, {}, { 'master-1': 'running' })).toBe(true)
    expect(isTeamConversationRunning(conversation, {}, { 'master-1': 'idle' })).toBe(false)
  })
})
