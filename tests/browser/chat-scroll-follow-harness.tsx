/* 滚动跟随修复冒烟 harness：真实浏览器复现"运行中切走→切回"的高度剧变窗口。
 * - 列表状态由 harness 持有：切走=卸载列表（缓存内容冻结），切回=先用冻结缓存重挂载，
 *   ~150ms 后补回离开期间的增量（模拟恢复合并）。
 * - 流式增长与挂载状态无关：切走期间继续追加内容（模拟 WS 帧持续写入）。
 * 运行：node tests/browser/chat-scroll-follow-smoke.mjs（需 chromium）。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ConversationMessageList } from '../../ui/src/components/chat/ConversationMessageList'
import type { ConversationAdapter } from '../../ui/src/components/chat/conversation-types'

const SESSION = 'scroll-session'

// 每次增长的段落数：单次高度增量 > 100px（旧实现裸阈值），复现"跟随滚动与内容增长竞态"误杀 pinned 的条件。
const CHUNK_PARAGRAPHS = 3

function paragraph(index: number): string {
  return `流式输出第 ${index} 段：${'内容持续增长，用于撑高流式气泡并验证跟随。'.repeat(4)}`
}

function paragraphs(count: number, from = 1): string {
  return Array.from({ length: count }, (_, index) => paragraph(from + index)).join('\n\n')
}

function buildAdapter(streamingContent: string, messageCount: number, staticExtra = 0, contentRevision = 0): ConversationAdapter {
  const messages = Array.from({ length: messageCount }, (_, index) => ({
    id: `${SESSION}:m-${index}`,
    session_id: SESSION,
    role: index % 2 === 0 ? 'human' : 'agent',
    // 末条历史消息在底部窗口内：staticExtra 模拟"非签名来源"的异步撑高（图片加载 / 工具块展开 /
    // 虚拟测量修正），不改变流式签名与条目数，因此不会触发任何跟随滚动。
    content: `第 ${index + 1} 条历史消息${index === messageCount - 1 && staticExtra > 0 ? `\n\n${paragraphs(staticExtra, 9000)}` : ''}`,
    thinking: null,
    tool_calls_json: null,
    decision_json: null,
    attachments_json: null,
    timestamp: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }))
  return {
    sessionId: SESSION,
    agentName: 'Agent',
    agentRuntime: 'claude',
    sessionTitle: null,
    messages,
    // 内容版本号：对齐生产 TeamChatPane 的 onBase/onReplay 递增（条目数不变也要能触发再锚定）。
    contentRevision,
    streamingMessage: {
      id: 'stream-1',
      role: 'agent',
      processBlocks: [],
      finalAnswer: streamingContent,
      content: streamingContent,
      thinking: '',
      toolCalls: [],
      done: false,
    },
    loading: false,
    error: null,
    running: true,
    sending: false,
    hasMoreMessages: false,
    loadingOlderMessages: false,
    pendingPermissions: [],
    pendingElicitations: [],
    interactionError: null,
    capabilities: { models: [], currentModelId: null, modes: [], currentModeId: null, supportsImages: true, configOptions: [], commands: [] },
    usage: null,
    sendPrompt: async () => undefined,
    cancel: async () => undefined,
    loadOlderMessages: async () => undefined,
    loadMessageProcess: async () => undefined,
    loadFileChanges: async () => undefined,
    loadProcessItemDetail: async () => undefined,
    respondPermission: async () => undefined,
    respondElicitation: async () => undefined,
  }
}

function Harness(): ReactElement {
  const [mounted, setMounted] = useState(true)
  const [instanceKey, setInstanceKey] = useState(0)
  const [messageCount, setMessageCount] = useState(45)
  const [streaming, setStreaming] = useState(false)
  const [live, setLive] = useState(() => paragraphs(30))
  const [shown, setShown] = useState(live)
  const [staticExtra, setStaticExtra] = useState(0)
  // 两段式装载（对齐生产 team 线）：base 先交付（条目数 0→20、气泡只有一句占位），
  // 宽限过期后 replay 合并补齐（条目数不变、气泡暴涨），每次落地递增内容版本号。
  const [twoStage, setTwoStage] = useState(false)
  const [replayParagraphs, setReplayParagraphs] = useState(0)
  const [contentRevision, setContentRevision] = useState(0)
  // dock「定位成员」等价物：定位锁生效中，内容版本再落地不得再锚定（不得把定位目标卷走）。
  const [location, setLocation] = useState<{ messageId: string; request: number }>()
  const locateCountRef = useRef(0)
  const liveRef = useRef(live)
  liveRef.current = live
  const catchupRef = useRef(false)
  const nextParagraphRef = useRef(31)

  // 流式增长：与列表挂载状态无关（切走期间累积，切回后一次性补回）。
  useEffect(() => {
    if (!streaming) return undefined
    const timer = window.setInterval(() => {
      const from = nextParagraphRef.current + 1
      nextParagraphRef.current += CHUNK_PARAGRAPHS
      setLive((current) => `${current}\n\n${paragraphs(CHUNK_PARAGRAPHS, from)}`)
    }, 60)
    return () => window.clearInterval(timer)
  }, [streaming])

  // 挂载期间跟随 live；切回后先用冻结缓存渲染，~150ms 才补回离开期间的增量（恢复合并）。
  useEffect(() => {
    if (!mounted) return undefined
    if (catchupRef.current) {
      const timer = window.setTimeout(() => {
        catchupRef.current = false
        setShown(liveRef.current)
      }, 150)
      return () => window.clearTimeout(timer)
    }
    setShown(live)
    return undefined
  }, [live, mounted])

  // 程序性回落注入（布局重排 / clamp / anchoring 补偿等价物）：无 wheel、无 pointer，仅 scrollTop 变化。
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__smoke = {
      dropPx: (px: number) => { const element = document.querySelector('.conversation-message-scroll') as HTMLElement | null; if (element) element.scrollTop = Math.max(0, element.scrollTop - px) },
    }
  }, [])

  const streamingContent = twoStage ? (replayParagraphs > 0 ? paragraphs(replayParagraphs) : '正在处理…') : shown
  const adapter = useMemo(() => buildAdapter(streamingContent, twoStage ? 20 : messageCount, staticExtra, contentRevision), [streamingContent, twoStage, messageCount, staticExtra, contentRevision])
  // 非签名来源撑高（图片加载 / 工具块 / 虚拟测量修正类）+ 立即派发一个 scroll 事件，
  // 模拟"内容先落进 DOM、上一帧程序化滚动的 scroll 事件才派发"的时序：断言该时序下
  // 跟随不被破坏（决策层误杀链条由 tests/unit/chat-auto-scroll.test.ts 确定性覆盖）。
  const simulateLateScroll = (): void => {
    flushSync(() => { setStaticExtra(6) })
    document.querySelector('.conversation-message-scroll')?.dispatchEvent(new Event('scroll'))
  }
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', margin: 0 }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, padding: 8 }}>
        <button id="btn-stream" onClick={() => setStreaming((value) => !value)}>{streaming ? '停止流式' : '开始流式'}</button>
        <button id="btn-away" onClick={() => setMounted(false)}>切走会话</button>
        <button id="btn-back" onClick={() => { catchupRef.current = true; setMounted(true); setInstanceKey((key) => key + 1) }}>切回会话</button>
        <button id="btn-late-scroll" onClick={simulateLateScroll}>模拟延迟滚动事件</button>
        <button id="btn-count-10" onClick={() => { setMessageCount(10); setInstanceKey((key) => key + 1) }}>10 条消息</button>
        <button id="btn-count-45" onClick={() => { setMessageCount(45); setInstanceKey((key) => key + 1) }}>45 条消息</button>
        <button id="btn-two-stage" onClick={() => { setTwoStage(true); setReplayParagraphs(0); setContentRevision(1); setInstanceKey((key) => key + 1) }}>两段式:base</button>
        <button id="btn-replay" onClick={() => { setReplayParagraphs(40); setContentRevision((value) => value + 1) }}>两段式:replay</button>
        <button id="btn-grow" onClick={() => { setReplayParagraphs((value) => value + 20); setContentRevision((value) => value + 1) }}>内容再落地</button>
        <button id="btn-two-stage-off" onClick={() => { setTwoStage(false); setReplayParagraphs(0); setContentRevision(0) }}>退出两段式</button>
        <button id="btn-replay-short" onClick={() => { setReplayParagraphs(18); setContentRevision((value) => value + 1) }}>短重放18段</button>
        <button id="btn-tiny-grow" onClick={() => { setReplayParagraphs((value) => value + 1); setContentRevision((value) => value + 1) }}>增量落地</button>
        <button id="btn-locate" onClick={() => { locateCountRef.current += 1; setLocation({ messageId: `${SESSION}:m-19`, request: locateCountRef.current }) }}>定位到 m-19</button>
        <span id="phase">{mounted ? 'mounted' : 'away'}</span>
      </div>
      {mounted
        ? <ConversationMessageList key={`${instanceKey}:${messageCount}`} adapter={adapter} location={location} />
        : <div id="placeholder" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>会话已切走（缓存冻结）</div>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)