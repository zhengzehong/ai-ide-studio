import { describe, expect, test } from 'vitest'
import { createAcpRuntimeClient } from '../../src/runtime/service/acp-runtime-client.js'
import type { RuntimeCoalescibleUpdate } from '../../src/runtime/streams/runtime-update-coalescer.js'
import type { SessionCapabilities } from '../../src/types/ws-protocol.js'

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

  test.each(['bypassPermissions', 'agent-full-access'])(
    'auto-approves arbitrary tools in full-access mode %s',
    async (permissionMode) => {
      const updates: RuntimeCoalescibleUpdate[] = []
      const router = createAcpRuntimeClient({
        agentId: 'agent-a',
        publishUpdate: (update) => { updates.push(update) },
        updateCapabilities: () => undefined,
      })
      router.bindSession('session-a', 'acp-a', [], permissionMode)

      const approved = await router.client.requestPermission({
        sessionId: 'acp-a',
        toolCall: { toolCallId: 'tool-a', title: 'mcp__external__dangerous_tool' },
        options: [
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        ],
      } as never)

      expect(approved).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
      expect(updates).toEqual([])
    },
  )

  test('prefers one-time approval in full-access mode when ACP offers both choices', async () => {
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: () => undefined,
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [], 'bypassPermissions')

    const approved = await router.client.requestPermission({
      sessionId: 'acp-a',
      toolCall: { toolCallId: 'tool-a', title: 'Terminal' },
      options: [
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      ],
    } as never)

    expect(approved).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } })
  })

  test('uses the latest Session mode when deciding whether to auto-approve', async () => {
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: () => undefined,
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [], 'bypassPermissions')
    router.setPermissionMode('session-a', 'default')

    const response = router.client.requestPermission({
      sessionId: 'acp-a',
      toolCall: { toolCallId: 'tool-a', title: 'Terminal' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    } as never)

    expect(router.hasPendingInteractions('session-a')).toBe(true)
    router.cancelSession('session-a')
    await expect(response).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('registers a pending permission before publishing it to the client', async () => {
    let resolvedDuringPublish = false
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => {
        if (update.kind !== 'session-update' || !update.data.permissionRequest) return
        resolvedDuringPublish = router.resolvePermission(
          update.sessionId,
          update.data.permissionRequest.id,
          'allow',
        )
      },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])

    const response = router.client.requestPermission({
      sessionId: 'acp-a',
      toolCall: { toolCallId: 'tool-a', title: 'Terminal' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    } as never)

    try {
      expect(resolvedDuringPublish).toBe(true)
      await expect(response).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
    } finally {
      router.close()
    }
  })

  test('cancels pending interactions when a Session is unbound', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])
    const permission = router.client.requestPermission({
      sessionId: 'acp-a',
      toolCall: { toolCallId: 'tool-a', title: 'Terminal' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    } as never)
    const elicitation = router.client.unstable_createElicitation({
      sessionId: 'acp-a',
      mode: 'form',
      message: 'Choose',
      requestedSchema: { type: 'object', properties: {} },
    } as never)

    router.unbindSession('session-a')

    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    await expect(elicitation).resolves.toEqual({ action: 'cancel' })
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'session-a',
        data: expect.objectContaining({ eventType: 'permission.result' }),
      }),
      expect.objectContaining({
        sessionId: 'session-a',
        data: expect.objectContaining({ eventType: 'elicitation.result' }),
      }),
    ]))
  })

  test('resolves all pending interactions when close is called repeatedly', async () => {
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: () => undefined,
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])
    const permission = router.client.requestPermission({
      sessionId: 'acp-a',
      toolCall: { toolCallId: 'tool-a', title: 'Terminal' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    } as never)

    router.close()
    router.close()

    await expect(permission).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('preserves user chunks and complete tool update content', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])
    router.beginTurn('session-a', 'message-a')

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-a',
        title: '',
        rawInput: { command: 'npm test' },
        content: [
          { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' },
          { type: 'terminal', terminalId: 'term-a' },
        ],
      },
    } as never)
    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-a',
        status: 'in_progress',
        _meta: {
          terminal_output_delta: { data: 'terminal line' },
          mcp_output_delta: { data: '50%' },
        },
      },
    } as never)
    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echoed user input' } },
    } as never)

    const data = updates.map((update) => update.kind === 'session-update' ? update.data : undefined)
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolCall: expect.objectContaining({
          title: '执行 npm test',
          content: [
            { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' },
            { type: 'terminal', terminalId: 'term-a' },
          ],
        }),
      }),
      expect.objectContaining({
        toolCallUpdate: expect.objectContaining({
          terminalOutputDelta: 'terminal line',
          progressDelta: '50%',
        }),
      }),
      expect.objectContaining({ content: 'echoed user input', eventType: 'user_message_chunk' }),
    ]))
  })

  test('publishes current mode capability changes', async () => {
    const published: SessionCapabilities[] = []
    let capabilities: SessionCapabilities = { modes: [], currentModeId: 'default' }
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: () => undefined,
      updateCapabilities: (_sessionId, update) => { capabilities = update(capabilities) },
      publishCapabilities: (_sessionId, next) => { published.push(next) },
    })
    router.bindSession('session-a', 'acp-a', [])

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' },
    } as never)

    expect(capabilities.currentModeId).toBe('plan')
    expect(published.at(-1)?.currentModeId).toBe('plan')
  })

  test('drops turn updates after the Runtime generation is fenced', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    let activeGeneration = 'generation-a'
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
      acceptTurnUpdate: (_sessionId, generation) => generation === activeGeneration,
    })
    router.bindSession('session-a', 'acp-a', [])
    router.beginTurn('session-a', 'message-a', 'turn-a', 'generation-a')

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'before' } },
    } as never)
    activeGeneration = 'generation-b'
    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } },
    } as never)

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ messageId: 'message-a', data: { contentDelta: 'before' } })
  })
})
