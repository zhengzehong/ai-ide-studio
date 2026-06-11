import { useEffect, type ReactNode } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import type {
  ChatTimelineGroup,
  FileChangeDetailInfo,
  FileChangeSummaryInfo,
  ImageAttachmentInfo,
  ToolCallInfo,
} from '../../stores/session-events'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import { TurnContentView } from '../chat/TurnContentView'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { FileChangesCard } from '../chat/FileChangesCard'
import { extractFileChangesFromToolCall, toolBlockHasDiff } from '../chat/file-changes-utils'
import { processBlockNeedsDetail } from '../chat/process-detail'
import { formatTime, toolSummary } from '../../pages/workspace/helpers'
import type { GlobalChatMsg } from './global-assistant.types'
import { AttachmentList } from './GlobalAssistantControls'

export function GlobalChatBubble({
  message,
  agentName,
  agentColorValue,
  isStreaming,
  footer,
  onLoadMessageProcess,
  onLoadMessageFileChanges,
  onLoadProcessItemDetail,
  fileChangeDetailsByMessageId,
  fileChangeLoadingByKey,
  fileChangeErrorByKey,
  processItemLoadingByKey,
  processItemErrorByKey,
  turnProcessLoadingByMessageId,
  turnProcessErrorByMessageId,
}: {
  message: GlobalChatMsg
  agentName: string
  agentColorValue: string
  isStreaming: boolean
  footer?: ReactNode
  onLoadMessageProcess: (sessionId: string, messageId: string) => void
  onLoadMessageFileChanges: (sessionId: string, messageId: string) => void
  onLoadProcessItemDetail: (sessionId: string, messageId: string, itemId: string) => void
  fileChangeDetailsByMessageId: Record<string, FileChangeDetailInfo>
  fileChangeLoadingByKey: Record<string, boolean>
  fileChangeErrorByKey: Record<string, string>
  processItemLoadingByKey: Record<string, boolean>
  processItemErrorByKey: Record<string, string>
  turnProcessLoadingByMessageId: Record<string, boolean>
  turnProcessErrorByMessageId: Record<string, string>
}) {
  const isHuman = message.role === 'human'
  const processBlocks = message.processBlocks || []
  const processCount = message.process_item_count ?? message.tool_call_count ?? 0
  const processLoaded = processBlocks.length > 0 || processCount === 0
  const fileChangesSummary = message.parsedFileChanges || parseJsonObject<FileChangeSummaryInfo>(message.file_changes_json)
  const fileChangesDetail = fileChangeDetailsByMessageId[message.id]
  const attachments = message.parsedAttachments || parseJsonArray<ImageAttachmentInfo>(message.attachments_json)
  const fallbackToolCalls = message.toolCalls || message.parsedToolCalls || parseJsonArray<ToolCallInfo>(message.tool_calls_json)
  const finalAnswer = message.finalAnswer ?? (processBlocks.length > 0 ? message.content : '')
  const showTurnView = processBlocks.length > 0 || finalAnswer || processCount > 0 || !!message.stage

  return (
    <div className={`global-assistant-bubble${isHuman ? ' global-assistant-bubble--human' : ''}`}>
      <span className="global-assistant-bubble-avatar" style={{ background: isHuman ? 'var(--bg-3)' : agentColorValue }}>
        {isHuman ? '我' : agentName.charAt(0).toUpperCase()}
      </span>
      <div className="global-assistant-bubble-main">
        <div className="global-assistant-bubble-meta">
          <strong>{isHuman ? '你' : agentName}</strong>
          {message.timestamp && <small>{formatTime(message.timestamp)}</small>}
          {isStreaming && <small className="global-assistant-streaming"><Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> {message.stage || '生成中'}</small>}
        </div>
        <div className="global-assistant-bubble-card">
          {attachments.length > 0 && <AttachmentList attachments={attachments} />}
          {showTurnView ? (
            <TurnContentView
              processBlocks={processBlocks}
              finalAnswer={finalAnswer}
              fallbackStage={message.stage}
              isStreaming={isStreaming}
              processCount={processCount}
              processLoaded={processLoaded}
              processLoading={turnProcessLoadingByMessageId[message.id]}
              processError={turnProcessErrorByMessageId[message.id]}
              fileChangesSummary={fileChangesSummary ?? undefined}
              fileChangesDetail={fileChangesDetail}
              fileChangesLoading={!!fileChangeLoadingByKey[`file:${message.id}`]}
              fileChangesError={fileChangeErrorByKey[`file:${message.id}`]}
              defaultProcessOpen={isStreaming || !!message.processDefaultOpen}
              onLoadProcess={message.session_id ? () => onLoadMessageProcess(message.session_id!, message.id) : undefined}
              onLoadFileChanges={message.session_id ? () => onLoadMessageFileChanges(message.session_id!, message.id) : undefined}
              renderProcessBlock={(block) => (
                <ProcessBlock
                  key={block.id}
                  block={block}
                  isStreaming={isStreaming}
                  detailLoading={processItemLoadingByKey[`${message.id}:${block.id}`]}
                  detailError={processItemErrorByKey[`${message.id}:${block.id}`]}
                  onLoadDetail={message.session_id ? () => onLoadProcessItemDetail(message.session_id!, message.id, block.id) : undefined}
                />
              )}
            />
          ) : (
            <>
              {message.thinking && <ProcessBlock block={{ id: `${message.id}:thinking`, kind: 'thinking', text: message.thinking }} isStreaming={isStreaming} />}
              {fallbackToolCalls.map((toolCall) => <ProcessBlock key={toolCall.id} block={{ id: toolCall.id, kind: 'tool', toolCall }} isStreaming={isStreaming} />)}
              {message.content && <MarkdownRenderer content={message.content} />}
            </>
          )}
          {footer}
        </div>
      </div>
    </div>
  )
}

export function TimelineGroupBubble({ item, agentName, agentColorValue }: { item: ChatTimelineGroup; agentName: string; agentColorValue: string }) {
  const first = item.blocks[0]
  return (
    <GlobalChatBubble
      message={{
        id: item.id,
        session_id: '',
        role: item.role,
        content: first?.kind === 'message' ? first.content : '',
        thinking: first?.kind === 'message' ? first.thinking || null : null,
        tool_calls_json: null,
        decision_json: null,
        attachments_json: null,
        file_changes_json: null,
        timestamp: item.timestamp,
        processBlocks: item.blocks.flatMap((block) => block.kind === 'tool' ? [{ id: block.id, kind: 'tool' as const, toolCall: block.toolCall }] : []),
        finalAnswer: item.blocks.filter((block) => block.kind === 'message').map((block) => block.content).join('\n'),
      }}
      agentName={agentName}
      agentColorValue={agentColorValue}
      isStreaming={false}
      onLoadMessageProcess={() => undefined}
      onLoadMessageFileChanges={() => undefined}
      onLoadProcessItemDetail={() => undefined}
      fileChangeDetailsByMessageId={{}}
      fileChangeLoadingByKey={{}}
      fileChangeErrorByKey={{}}
      processItemLoadingByKey={{}}
      processItemErrorByKey={{}}
      turnProcessLoadingByMessageId={{}}
      turnProcessErrorByMessageId={{}}
    />
  )
}

export function BlockingInteraction({ agentName, panel }: { agentName: string; panel: ReactNode }) {
  return <div className="global-assistant-blocking"><strong>{agentName} 正在等待确认</strong>{panel}</div>
}

function ProcessBlock({ block, isStreaming, detailLoading, detailError, onLoadDetail }: { block: TurnProcessBlock; isStreaming: boolean; detailLoading?: boolean; detailError?: string; onLoadDetail?: () => void }) {
  useEffect(() => {
    if (processBlockNeedsDetail(block) && block.kind !== 'tool' && !detailLoading && !detailError) onLoadDetail?.()
  }, [block, detailError, detailLoading, onLoadDetail])

  if (block.kind === 'tool') {
    const diffEntries = toolBlockHasDiff(block.toolCall) ? extractFileChangesFromToolCall(block.toolCall) : []
    return (
      <div className="global-assistant-process-card">
        <div className="global-assistant-process-title">
          {isStreaming && (block.toolCall.status === 'pending' || block.toolCall.status === 'in_progress') ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Wrench size={12} />}
          <span>{toolSummary(block.toolCall)}</span>
        </div>
        {detailLoading && <small>正在加载详情...</small>}
        {detailError && <small className="global-assistant-error">{detailError}</small>}
        {block.toolCall.rawInput != null && <pre>{stringifyShort(block.toolCall.rawInput)}</pre>}
        {block.toolCall.terminalOutput && <pre>{block.toolCall.terminalOutput.slice(-1600)}</pre>}
        {block.toolCall.rawOutput != null && <pre>{stringifyShort(block.toolCall.rawOutput)}</pre>}
        {diffEntries.length > 0 && <FileChangesCard changes={{ files: diffEntries, totalAdded: diffEntries.reduce((sum, file) => sum + file.addedLines, 0), totalDeleted: diffEntries.reduce((sum, file) => sum + file.deletedLines, 0) }} compact />}
      </div>
    )
  }
  if (block.kind === 'thinking') return <div className="global-assistant-process-card"><small>思考过程</small><MarkdownRenderer content={block.text} /></div>
  if (block.kind === 'file_change') {
    if (block.changes) return <FileChangesCard changes={block.changes} compact />
    return <div className="global-assistant-process-card">{block.summary || '文件修改'}</div>
  }
  if (block.kind === 'plan') return <div className="global-assistant-process-card">{block.plan.map((item) => <div key={item.content}>{item.status === 'completed' ? '✓' : '•'} {item.content}</div>)}</div>
  if (block.kind === 'permission') return <div className="global-assistant-process-card">权限请求：{block.summary || block.title}</div>
  if (block.kind === 'elicitation') return <div className="global-assistant-process-card">AI 提问：{block.message || block.summary || block.title}</div>
  return <div className="global-assistant-process-card">{block.kind === 'stage' ? block.text : <MarkdownRenderer content={block.text} />}</div>
}

function parseJsonArray<T>(raw?: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function parseJsonObject<T>(raw?: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function stringifyShort(value: unknown): string {
  return (typeof value === 'string' ? value : JSON.stringify(value, null, 2)).slice(0, 1200)
}
