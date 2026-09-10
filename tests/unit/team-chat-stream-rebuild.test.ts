import { describe, expect, it } from 'vitest'
import { emptySnapshot, hasLiveStreaming, mergeLoadedSnapshots, rebuildStreamingFromEvents, TEAM_STREAM_REBUILD_EVENT_LIMIT, type Snapshot } from '../../ui/src/components/team/TeamChatPane'

function event(id: string, type: string, payload: Record<string, unknown>, sequence = Number(id.slice(1))) {
  return { id, session_id: 's1', message_id: typeof payload.messageId === 'string' ? payload.messageId : null, sequence, type, payload_json: JSON.stringify(payload), created_at: '2026-09-10T00:00:00.000Z' }
}

function shellStreaming(id: string) {
  return { id, role: 'agent' as const, content: '', finalAnswer: '', thinking: '', processBlocks: [], toolCalls: [], done: false }
}

describe('team chat stream rebuild (方案3 全量事件重建)', () => {
  it('rebuilds the in-flight turn content from persisted chunk events', () => {
    const events = [
      event('e1', 'message.chunk', { messageId: 'm1', role: 'agent', contentDelta: '切回前已流出' }, 1),
      event('e2', 'thinking.chunk', { messageId: 'm1', thinking: '思考片段' }, 2),
      event('e3', 'message.chunk', { messageId: 'm1', role: 'agent', contentDelta: '的第二段' }, 3),
    ]
    const rebuilt = rebuildStreamingFromEvents(events)
    expect(rebuilt).not.toBeNull()
    expect(rebuilt?.id).toBe('m1')
    // thinking 之后的 reply 会把先前文本降级为 note 过程块,finalAnswer 只保留最后一段——与 live 聚合同一 reducer,渲染语义一致
    expect(rebuilt?.finalAnswer).toBe('的第二段')
    const noteBlock = rebuilt?.processBlocks.find((block) => block.kind === 'note')
    expect(noteBlock && 'text' in noteBlock ? noteBlock.text : '').toBe('切回前已流出')
    expect(rebuilt?.thinking).toBe('思考片段')
    expect(rebuilt?.done).toBe(false)
  })

  it('returns null when the window only contains completed turns (no resurrection)', () => {
    const events = [
      event('e1', 'message.chunk', { messageId: 'm0', role: 'agent', contentDelta: '已完成回合' }, 1),
      event('e2', 'message.done', { messageId: 'm0', stopReason: 'end_turn' }, 2),
    ]
    expect(rebuildStreamingFromEvents(events)).toBeNull()
    expect(rebuildStreamingFromEvents([])).toBeNull()
  })

  it('keeps only the trailing in-flight turn when the window spans multiple turns', () => {
    const events = [
      event('e1', 'message.chunk', { messageId: 'm0', role: 'agent', contentDelta: '旧回合' }, 1),
      event('e2', 'message.done', { messageId: 'm0' }, 2),
      event('e3', 'message.chunk', { messageId: 'm1', role: 'agent', contentDelta: '正在执行回合' }, 3),
    ]
    const rebuilt = rebuildStreamingFromEvents(events)
    expect(rebuilt?.id).toBe('m1')
    expect(rebuilt?.finalAnswer).toBe('正在执行回合')
  })

  it('does not treat permission history as pending when only streaming is extracted', () => {
    const events = [
      event('e1', 'permission.request', { permissionRequest: { id: 'p1', title: '旧权限' } }, 1),
      event('e2', 'message.chunk', { messageId: 'm1', role: 'agent', contentDelta: '内容' }, 2),
    ]
    const rebuilt = rebuildStreamingFromEvents(events)
    expect(rebuilt?.finalAnswer).toBe('内容')
  })

  it('rebuild limit aligns with the server MAX_EVENT_LIMIT window', () => {
    expect(TEAM_STREAM_REBUILD_EVENT_LIMIT).toBe(1000)
  })

  it('hasLiveStreaming distinguishes real streamed content from the empty shell', () => {
    const empty: Record<string, Snapshot> = {}
    expect(hasLiveStreaming(empty.s1)).toBe(false)

    const shell = { ...emptySnapshot('s1'), streaming: shellStreaming('m1'), running: true }
    expect(hasLiveStreaming(shell)).toBe(false)

    const withText = { ...shell, streaming: { ...shellStreaming('m1'), content: 'A', finalAnswer: 'A' } }
    expect(hasLiveStreaming(withText)).toBe(true)

    const withBlocks = { ...shell, streaming: { ...shellStreaming('m1'), processBlocks: [{ id: 'b1', kind: 'tool' as const, toolCall: { id: 't1', title: '读文件' } }] } }
    expect(hasLiveStreaming(withBlocks)).toBe(true)

    const doneTurn = { ...shell, streaming: { ...shellStreaming('m1'), content: 'A', finalAnswer: 'A', done: true } }
    expect(hasLiveStreaming(doneTurn)).toBe(false)
  })

  it('merge keeps the rebuilt full content over the empty shell from remount', () => {
    const previous: Record<string, Snapshot> = {
      s1: { ...emptySnapshot('s1'), streaming: shellStreaming('m1'), running: true },
    }
    const loaded: Record<string, Snapshot> = {
      s1: { ...emptySnapshot('s1'), streaming: { ...shellStreaming('m1'), content: '重建完整内容', finalAnswer: '重建完整内容' }, running: true },
    }
    const merged = mergeLoadedSnapshots(previous, loaded)
    expect(merged.s1?.streaming?.content).toBe('重建完整内容')
    expect(merged.s1?.running).toBe(true)
  })
})
