import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { secretaryAttentionCount, totalSecretaryAttention } from '../../ui/src/stores/secretary-attention'
import type { SecretaryData } from '../../ui/src/stores/secretary.store'

const secretary: SecretaryData = {
  id: 'secretary-1', projectId: 'project-1', name: 'Delivery secretary', definitionPrompt: '', reportPrompt: '',
  executionAgentId: 'agent-1', runtimeSessionId: 'runtime-1', chatSessionId: 'chat-1', enabled: true,
  observeAll: true, observedAgentIds: [], triggers: [], lastRunAt: null, lastError: null,
  unreadCount: 2, chatUnread: true, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
}

describe('secretary attention UI', () => {
  test('keeps mail counts and one chat reply as separate attention facts', () => {
    expect(secretaryAttentionCount(secretary)).toBe(3)
    expect(totalSecretaryAttention([secretary, { unreadCount: 0, chatUnread: false }])).toBe(3)
  })

  test('keeps secretary attention on PC while APP uses four primary tabs', () => {
    const pc = readFileSync(resolve('ui/src/components/layout/AppLayout.tsx'), 'utf8')
    const app = readFileSync(resolve('mobile/src/components/MobileShell.tsx'), 'utf8')
    expect(pc).toContain('totalSecretaryAttention(secretaries)')
    expect(pc).toContain('条秘书提醒')
    expect(app).not.toContain("label: '秘书'")
  })
})
