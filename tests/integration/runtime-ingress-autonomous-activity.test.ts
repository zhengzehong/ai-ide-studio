import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { sessionStore } from '../../src/store/sessions.js'
import { events } from '../../src/core/events.js'
import { handleRuntimeDone } from '../../src/runtime/api/runtime-ingress.js'
import type { SessionActivityData, SessionDoneData } from '../../src/types/ws-protocol.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-autonomous-activity-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

function collectBusEvents() {
  const activities: SessionActivityData[] = []
  const done: SessionDoneData[] = []
  const onActivity = (event: SessionActivityData): void => { activities.push(event) }
  const onDone = (event: SessionDoneData): void => { done.push(event) }
  events.on('session:activity', onActivity)
  events.on('session:done', onDone)
  return {
    activities,
    done,
    detach: () => {
      events.off('session:activity', onActivity)
      events.off('session:done', onDone)
    },
  }
}

describe('runtime ingress 自治回合活动桥(N1:合成 idle 回流核心总线)', () => {
  test('合成 done(auto-*)在核心总线补发 idle 活动,dispatcher/wake 生产可达', async () => {
    const session = sessionStore.create({ agentId: 'agent-a', projectId: null })
    const watched = collectBusEvents()
    try {
      await handleRuntimeDone({
        sessionId: session.id,
        agentId: 'agent-a',
        messageId: 'auto-c1f0',
        stopReason: 'end_turn',
        streamGeneration: 'generation-a',
        sequence: 1,
      })
    } finally {
      watched.detach()
    }

    expect(watched.done).toHaveLength(1)
    expect(watched.activities).toEqual([{
      sessionId: session.id,
      agentId: 'agent-a',
      state: 'idle',
      reason: 'autonomous-done',
      timestamp: expect.any(String),
      source: 'runtime',
    }])
  })

  test('取消的合成回合落 autonomous-cancelled(不误标完成)', async () => {
    const session = sessionStore.create({ agentId: 'agent-a', projectId: null })
    const watched = collectBusEvents()
    try {
      await handleRuntimeDone({
        sessionId: session.id,
        agentId: 'agent-a',
        messageId: 'auto-cancel',
        stopReason: 'cancelled',
        streamGeneration: 'generation-a',
        sequence: 2,
      })
    } finally {
      watched.detach()
    }

    expect(watched.activities).toEqual([expect.objectContaining({
      sessionId: session.id,
      state: 'idle',
      reason: 'autonomous-cancelled',
      source: 'runtime',
    })])
  })

  test('真回合 done 不补发活动(既有 prompt 生命周期不受干扰)', async () => {
    const session = sessionStore.create({ agentId: 'agent-a', projectId: null })
    const watched = collectBusEvents()
    try {
      await handleRuntimeDone({
        sessionId: session.id,
        agentId: 'agent-a',
        messageId: 'msg-turn-1789450000000-aaaa',
        stopReason: 'end_turn',
        streamGeneration: 'generation-a',
        sequence: 3,
      })
    } finally {
      watched.detach()
    }

    expect(watched.done).toHaveLength(1)
    expect(watched.activities).toEqual([])
  })
})