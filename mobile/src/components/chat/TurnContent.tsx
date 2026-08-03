import { memo, useState, useMemo, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronRight, Clock, DollarSign } from 'lucide-react'
import {
  isFilesPresentationToolCall,
  parseFilesPresentationOutput,
  type FilesPresentationInfo,
  type MessageData,
  type PreviewPresentationInfo,
} from '@desktop/stores/session-events'
import type { TurnViewModel } from '@desktop/stores/turn-blocks'
import { elapsedSecondsBetween } from '@desktop/utils/duration'
import ProcessBlock from './ProcessBlock'
import PreviewCard from './PreviewCard'
import FileChangesCard, { extractFileChangesFromBlocks } from './FileChangesCard'
import { CodeView } from '../file-viewer/CodeView'
import { isPreviewPublishTool, parsePreviewPublishOutput } from '../../utils/preview-tool'
import { FilesPresentationCard } from './FilesPresentationCard'

interface Props {
  message?: MessageData
  streaming?: TurnViewModel | null
  processLoading?: boolean
  processError?: string
  onLoadProcess?: (sessionId: string, messageId: string) => void
  onOpenPreview?: (previewId: string, target: 'pc' | 'app') => void
  onOpenFiles?: (presentation: FilesPresentationInfo) => void
  liveElapsedSeconds?: number
}

type ProcessOpenOverride = 'open' | 'closed' | null

export function resolveProcessOpen(defaultProcessOpen: boolean, override: ProcessOpenOverride): boolean {
  return override === 'open' || (override !== 'closed' && defaultProcessOpen)
}

export const markdownListStyle: CSSProperties = {
  margin: '4px 0',
  paddingInlineStart: 18,
}

export const markdownListItemStyle: CSSProperties = {
  margin: '2px 0',
  paddingLeft: 2,
}

export function deriveTurnElapsedSeconds(input: {
  turnStats: Record<string, number> | null
  message?: Pick<MessageData, 'started_at' | 'completed_at'> | null
  isStreaming: boolean
  liveElapsedSeconds?: number
}): number | undefined {
  return input.turnStats?.elapsedSeconds
    ?? (input.isStreaming
      ? input.liveElapsedSeconds
      : elapsedSecondsBetween(input.message?.started_at, input.message?.completed_at))
}

export default memo(function TurnContent({ message, streaming, processLoading = false, processError, onLoadProcess, onOpenPreview, onOpenFiles, liveElapsedSeconds }: Props) {
  const [processOpenOverride, setProcessOpenOverride] = useState<ProcessOpenOverride>(null)

  const processBlocks = streaming?.processBlocks ?? message?.processBlocks ?? []
  const finalAnswer = streaming?.finalAnswer ?? message?.finalAnswer ?? message?.content ?? ''
  const isStreaming = !!streaming && !streaming.done
  const stage = streaming?.stage
  const turnStats = useMemo(() => parseTurnStats(message?.decision_json), [message?.decision_json])
  const visibleBlocks = processBlocks.filter(b => b.kind !== 'stage')
  const fileChanges = useMemo(() => extractFileChangesFromBlocks(processBlocks), [processBlocks])
  const processCount = message?.process_item_count ?? message?.tool_call_count ?? 0
  const canLoadProcess = !isStreaming && !!message?.session_id && processCount > 0 && !message.processBlocks
  const previewBlocks = visibleBlocks.filter(
    (block) => block.kind === 'tool' && isPreviewPublishTool(block.toolCall.title),
  )
  const realtimePreviewIds = new Set(previewBlocks.flatMap((block) => {
    if (block.kind !== 'tool') return []
    const parsed = parsePreviewPublishOutput(block.toolCall.rawOutput)
    return parsed ? [parsed.previewId] : []
  }))
  const persistedPreviews = (message?.parsedPresentations ?? [])
    .filter((item): item is PreviewPresentationInfo => item.kind === 'preview')
    .filter((preview) => !realtimePreviewIds.has(preview.previewId))
  const filesBlocks = visibleBlocks.filter(
    (block) => block.kind === 'tool' && isFilesPresentationToolCall(block.toolCall),
  )
  const realtimeFilesIds = new Set(filesBlocks.flatMap((block) => {
    if (block.kind !== 'tool') return []
    const parsed = parseFilesPresentationOutput(block.toolCall.rawOutput)
    return parsed ? [parsed.presentationId] : []
  }))
  const persistedFiles = (message?.parsedPresentations ?? [])
    .filter((item): item is FilesPresentationInfo => item.kind === 'files')
    .filter((presentation) => !realtimeFilesIds.has(presentation.presentationId))
  const presentationBlocks = new Set([...previewBlocks, ...filesBlocks])
  const otherBlocks = visibleBlocks.filter((block) => !presentationBlocks.has(block))
  const hasPreviewCard = previewBlocks.length > 0 || persistedPreviews.length > 0
  const hasFilesCard = filesBlocks.length > 0 || persistedFiles.length > 0
  const hasProcess = otherBlocks.length > 0 || canLoadProcess || (isStreaming && !!stage)
  const processOpen = resolveProcessOpen(isStreaming, processOpenOverride)
  const processLabelCount = otherBlocks.length > 0 ? otherBlocks.length : processCount
  const elapsedSeconds = deriveTurnElapsedSeconds({ turnStats, message, isStreaming, liveElapsedSeconds })
  const showStats = !!turnStats || elapsedSeconds != null

  const toggleProcess = () => {
    const nextOpen = !processOpen
    setProcessOpenOverride(nextOpen ? 'open' : 'closed')
    if (nextOpen && canLoadProcess && !processLoading) {
      onLoadProcess?.(message.session_id, message.id)
    }
  }

  return (
    <div>
      {hasProcess && (
        <div style={styles.processSection}>
          <button style={styles.processToggle} onClick={toggleProcess}>
            {processOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span style={styles.processLabel}>执行过程{processLabelCount > 0 ? ` (${processLabelCount})` : ''}</span>
          </button>
          {processOpen && (
            <div style={styles.processList}>
              {otherBlocks.map(block => <ProcessBlock key={block.id} block={block} />)}
              {otherBlocks.length === 0 && stage && <div style={styles.processState}>{stage}</div>}
              {processLoading && <div style={styles.processState}>正在加载执行过程...</div>}
              {processError && <div style={{ ...styles.processState, color: 'var(--error)' }}>{processError}</div>}
              {!processLoading && !processError && otherBlocks.length === 0 && !stage && (
                <div style={styles.processState}>暂无可恢复的执行过程</div>
              )}
            </div>
          )}
        </div>
      )}

      {stage && !finalAnswer && !hasProcess && (
        <div style={styles.stageIndicator}>{stage}</div>
      )}

      {finalAnswer && (
        <div style={styles.markdownWrap}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const text = String(children ?? '')
                const match = /language-(\w+)/.exec(className || '')
                const lang = match?.[1] || 'text'
                const isInline = !className && !text.includes('\n')
                if (isInline) {
                  return <code style={styles.codeInline} {...props}>{children}</code>
                }
                return <CodeView content={text.replace(/\n$/, '')} language={lang} embedded />
              },
              ol: ({ children }) => <ol style={markdownListStyle}>{children}</ol>,
              ul: ({ children }) => <ul style={markdownListStyle}>{children}</ul>,
              li: ({ children }) => <li style={markdownListItemStyle}>{children}</li>,
              p: ({ children }) => <p style={styles.paragraph}>{children}</p>,
            }}
          >
            {finalAnswer}
          </ReactMarkdown>
        </div>
      )}

      {hasPreviewCard && (
        <div style={{ marginTop: finalAnswer ? 10 : 0 }}>
          {previewBlocks.map(block => <ProcessBlock key={block.id} block={block} />)}
          {persistedPreviews.map((preview) => (
            <PreviewCard
              key={preview.previewId}
              preview={preview}
              onOpen={(previewId) => onOpenPreview?.(previewId, preview.target)}
            />
          ))}
        </div>
      )}

      {hasFilesCard && (
        <div style={{ marginTop: finalAnswer || hasPreviewCard ? 10 : 0 }}>
          {filesBlocks.map((block) => {
            if (block.kind !== 'tool') return null
            const presentation = parseFilesPresentationOutput(block.toolCall.rawOutput)
            return presentation
              ? <FilesPresentationCard key={block.id} presentation={presentation} onOpen={(item) => onOpenFiles?.(item)} />
              : null
          })}
          {persistedFiles.map((presentation) => (
            <FilesPresentationCard key={presentation.presentationId} presentation={presentation} onOpen={(item) => onOpenFiles?.(item)} />
          ))}
        </div>
      )}

      {!isStreaming && fileChanges.length > 0 && <FileChangesCard files={fileChanges} />}

      {showStats && (
        <div style={styles.stats}>
          {elapsedSeconds != null && (
            <span style={styles.statItem}><Clock size={11} /> {elapsedSeconds}s</span>
          )}
          {turnStats?.inputTokens != null && (
            <span style={styles.statItem}>输入 {formatTokens(turnStats.inputTokens)}</span>
          )}
          {turnStats?.outputTokens != null && (
            <span style={styles.statItem}>输出 {formatTokens(turnStats.outputTokens)}</span>
          )}
          {turnStats?.cachedReadTokens != null && turnStats.cachedReadTokens > 0 && (
            <span style={styles.statItem}>缓存 {formatTokens(turnStats.cachedReadTokens)}</span>
          )}
          {turnStats?.costAmount != null && (
            <span style={styles.statItem}><DollarSign size={11} /> ${turnStats.costAmount.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  )
})

function parseTurnStats(json: string | null | undefined): Record<string, number> | null {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

const styles: Record<string, CSSProperties> = {
  processSection: {
    marginBottom: 8,
    borderBottom: '1px solid var(--border-light)',
    paddingBottom: 6,
  },
  processToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 0',
    color: 'var(--text-secondary)',
    width: '100%',
    textAlign: 'left',
  },
  processLabel: {
    fontSize: 12,
    fontWeight: 500,
  },
  processList: {
    paddingLeft: 4,
  },
  processState: {
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '4px 0',
  },
  stageIndicator: {
    fontSize: 13,
    color: 'var(--primary)',
    fontWeight: 500,
    padding: '4px 0',
  },
  markdownWrap: {
    fontSize: 14,
    lineHeight: 1.7,
    overflowWrap: 'break-word',
  },
  paragraph: {
    margin: '4px 0',
  },
  codeInline: {
    padding: '1px 5px',
    borderRadius: 4,
    background: 'var(--bg-input)',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  stats: {
    display: 'flex',
    gap: 10,
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1px solid var(--border-light)',
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 11,
    color: 'var(--text-muted)',
  },
}
