import { describe, expect, test, vi } from 'vitest'
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

  test('preserves the active turn when the same ACP Session is rebound', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])
    router.beginTurn('session-a', 'message-a', 'turn-a', 'generation-a')

    router.bindSession('session-a', 'acp-a', ['team.mailbox.send'], 'bypassPermissions', 128000)
    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'after rebind' } },
    } as never)

    expect(updates).toEqual([expect.objectContaining({
      messageId: 'message-a',
      data: expect.objectContaining({ messageId: 'message-a', contentDelta: 'after rebind' }),
    })])
  })

  test('drops turn-scoped updates that arrive without an active turn binding', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [])

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'orphaned' } },
    } as never)

    expect(updates).toEqual([])
  })

  test('reports the applied model profile context window instead of the ACP fallback', async () => {
    const updates: RuntimeCoalescibleUpdate[] = []
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: (update) => { updates.push(update) },
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [], undefined, 128000)
    router.beginTurn('session-a', 'message-a')

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: { sessionUpdate: 'usage_update', size: 200000, used: 64000 },
    } as never)

    expect(updates.at(-1)).toMatchObject({
      sessionId: 'session-a',
      data: { usage: { contextSize: 128000, contextUsed: 64000 } },
    })
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

  test('uses an id-only mode config update when deciding whether to auto-approve', async () => {
    const router = createAcpRuntimeClient({
      agentId: 'agent-a',
      publishUpdate: () => undefined,
      updateCapabilities: () => undefined,
    })
    router.bindSession('session-a', 'acp-a', [], 'bypassPermissions')

    await router.client.sessionUpdate({
      sessionId: 'acp-a',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: [{
          id: 'mode',
          name: 'Permission mode',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'bypassPermissions', name: 'Bypass permissions' },
          ],
        }],
      },
    } as never)
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

  describe('autonomous turn binding (后台唤醒)', () => {
    function createBridge(overrides: Partial<Record<'handleUnboundFrame' | 'observeFrame' | 'onRealTurnBegin' | 'onRealTurnEnd', unknown>> = {}) {
      let created = 0
      return {
        handleUnboundFrame: vi.fn(() => `auto-${++created}`),
        observeFrame: vi.fn(),
        onRealTurnBegin: vi.fn(),
        onRealTurnEnd: vi.fn(),
        ...overrides,
      } as {
        handleUnboundFrame: ReturnType<typeof vi.fn>
        observeFrame: ReturnType<typeof vi.fn>
        onRealTurnBegin: ReturnType<typeof vi.fn>
        onRealTurnEnd: ReturnType<typeof vi.fn>
      }
    }

    test('P0①:无绑定强帧绑定合成回合,publish 不经过 acceptTurnUpdate 二次门(无 generation)', async () => {
      const updates: RuntimeCoalescibleUpdate[] = []
      const bridge = createBridge()
      const acceptTurnUpdate = vi.fn(() => false)
      const router = createAcpRuntimeClient({
        agentId: 'agent-a',
        publishUpdate: (update) => { updates.push(update) },
        updateCapabilities: () => undefined,
        acceptTurnUpdate,
        autonomousTurns: bridge,
      })
      router.bindSession('session-a', 'acp-a', [])

      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hidden' } },
      } as never)
      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'out' } },
      } as never)

      // 钩子只触发一次(第二帧走已绑定路径);每帧都进入观察
      expect(bridge.handleUnboundFrame).toHaveBeenCalledTimes(1)
      expect(bridge.observeFrame).toHaveBeenCalledTimes(2)
      expect(updates).toEqual([
        expect.objectContaining({ sessionId: 'session-a', messageId: 'auto-1', data: expect.objectContaining({ thinking: 'hidden' }) }),
        expect.objectContaining({ sessionId: 'session-a', messageId: 'auto-1', data: expect.objectContaining({ contentDelta: 'out' }) }),
      ])
      // 合成绑定刻意不带 streamGeneration:publish 的 acceptTurnUpdate 门完全未被咨询
      expect(acceptTurnUpdate).not.toHaveBeenCalled()
    })

    test('无绑定弱帧(usage/tool_call_update)交给桥分类,返回 null 即丢弃', async () => {
      const updates: RuntimeCoalescibleUpdate[] = []
      const bridge = createBridge({ handleUnboundFrame: vi.fn(() => null) })
      const router = createAcpRuntimeClient({
        agentId: 'agent-a',
        publishUpdate: (update) => { updates.push(update) },
        updateCapabilities: () => undefined,
        autonomousTurns: bridge,
      })
      router.bindSession('session-a', 'acp-a', [])

      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'usage_update', size: 200000, used: 1000 },
      } as never)
      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'orphan-1', status: 'completed' },
      } as never)

      expect(updates).toEqual([])
      expect(bridge.handleUnboundFrame).toHaveBeenCalledTimes(2)
      expect(bridge.observeFrame).not.toHaveBeenCalled()
    })

    test('合成回合内 tool_call_update 正常发布(心跳追踪器随合成绑定创建)', async () => {
      const updates: RuntimeCoalescibleUpdate[] = []
      const router = createAcpRuntimeClient({
        agentId: 'agent-a',
        publishUpdate: (update) => { updates.push(update) },
        updateCapabilities: () => undefined,
        autonomousTurns: createBridge(),
      })
      router.bindSession('session-a', 'acp-a', [])

      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Bash', rawInput: { command: 'npm test' } },
      } as never)
      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          status: 'in_progress',
          _meta: { terminal_output_delta: { data: 'building…' } },
        },
      } as never)

      expect(updates).toHaveLength(2)
      expect(updates[1]).toMatchObject({
        messageId: 'auto-1',
        data: expect.objectContaining({
          toolCallUpdate: expect.objectContaining({ id: 'tool-1', terminalOutputDelta: 'building…' }),
        }),
      })
    })

    test('endSyntheticTurn 只解绑匹配的合成 id', async () => {
      const updates: RuntimeCoalescibleUpdate[] = []
      const bridge = createBridge()
      const router = createAcpRuntimeClient({
        agentId: 'agent-a',
        publishUpdate: (update) => { updates.push(update) },
        updateCapabilities: () => undefined,
        autonomousTurns: bridge,
      })
      router.bindSession('session-a', 'acp-a', [])

      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'one' } },
      } as never)
      // 不匹配的 id 不解绑
      router.endSyntheticTurn('session-a', 'auto-other')
      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'two' } },
      } as never)
      expect(bridge.handleUnboundFrame).toHaveBeenCalledTimes(1)

      // 匹配的 id 解绑 → 下一帧重新走分类并开新合成回合
      router.endSyntheticTurn('session-a', 'auto-1')
      await router.client.sessionUpdate({
        sessionId: 'acp-a',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'three' } },
      } as never)
      expect(bridge.handleUnboundFrame).toHaveBeenCalledTimes(2)
      expect(updates.at(-1)).toMatchObject({ messageId: 'auto-2', data: { contentDelta: 'three' } })
    })

    test('真回合 begin/end 触发互斥回调', () => {
      const bridge = createBridge()
      const router = createAcpRuntimeClient({
        agentId: 'agent-a',
        publishUpdate: () => undefined,
        updateCapabilities: () => undefined,
        autonomousTurns: bridge,
      })
      router.bindSession('session-a', 'acp-a', [])

      router.beginTurn('session-a', 'message-a', 'turn-a', 'generation-a')
      expect(bridge.onRealTurnBegin).toHaveBeenCalledWith('session-a')

      router.endTurn('session-a', 'generation-a')
      expect(bridge.onRealTurnEnd).toHaveBeenCalledWith('session-a')
    })
  })
})
