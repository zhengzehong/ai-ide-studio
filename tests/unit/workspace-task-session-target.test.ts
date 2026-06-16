import { describe, expect, it } from 'vitest'

import { buildWorkspaceTaskCreateTarget } from '../../ui/src/pages/workspace/task-session-target.ts'

describe('workspace task session target', () => {
  it('uses fixed new sessions by default when an agent is selected', () => {
    expect(buildWorkspaceTaskCreateTarget({ agentId: 'agent-1', sessionMode: 'new_fixed', sessionId: '' })).toEqual({
      agentId: 'agent-1',
      sessionMode: 'new_fixed',
      sessionId: undefined,
    })
  })

  it('passes an existing session only in existing mode', () => {
    expect(buildWorkspaceTaskCreateTarget({ agentId: 'agent-1', sessionMode: 'existing', sessionId: 'sess-1' })).toEqual({
      agentId: 'agent-1',
      sessionMode: 'existing',
      sessionId: 'sess-1',
    })
  })

  it('omits session strategy when no agent is selected', () => {
    expect(buildWorkspaceTaskCreateTarget({ agentId: '', sessionMode: 'new_fixed', sessionId: 'sess-1' })).toEqual({
      agentId: undefined,
      sessionMode: undefined,
      sessionId: undefined,
    })
  })
})
