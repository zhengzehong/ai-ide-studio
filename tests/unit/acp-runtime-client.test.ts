import { describe, expect, test } from 'vitest'
import { createAcpRuntimeClient } from '../../src/runtime/service/acp-runtime-client.js'
import type { RuntimeCoalescibleUpdate } from '../../src/runtime/streams/runtime-update-coalescer.js'

describe('database-free ACP Runtime client', () => {
  test('maps ACP text updates onto the bound Studio Session', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])
    router.beginTurn('session-a', 'message-a', 'turn-a')

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as never)

    expect(updates).toEqual([expect.objectContaining({
      kind: 'session-update',
      sessionId: 'session-a',
      messageId: 'message-a',
      data: expect.objectContaining({ contentDelta: 'hello' }),
    })])
  })

  test('auto-approves only snapshot-authorized internal Team tools', async () => {
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: () => undefined,
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', ['team.mailbox.send'])

    const approved = await router.client.requestPermission({
      sessionId: 'acp-a',
      toolCall: { toolCallId: 'tool-a', title: 'mcp__ai_ide_tools__team_mailbox_send' },
      options: [
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      ],
    } as never)

    expect(approved).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
  })
})
