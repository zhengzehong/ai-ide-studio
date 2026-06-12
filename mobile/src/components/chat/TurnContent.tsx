import { useState, useMemo, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronRight, Clock, Zap, DollarSign } from 'lucide-react'
import type { MessageData } from '@desktop/stores/session-events'
import type { TurnViewModel } from '@desktop/stores/turn-blocks'
import { elapsedSecondsBetween } from '@desktop/utils/duration'
import ProcessBlock from './ProcessBlock'
import FileChangesCard, { extractFileChangesFromBlocks } from './FileChangesCard'

interface Props {
  message?: MessageData
  streaming?: TurnViewModel | null
  processLoading?: boolean
  processError?: string
  onLoadProcess?: (sessionId: string, messageId: string) => void
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

export default function TurnContent({ message, streaming, processLoading = false, processError, onLoadProcess, liveElapsedSeconds }: Props) {
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
  const hasProcess = visibleBlocks.length > 0 || canLoadProcess || (isStreaming && !!stage)
  const processOpen = resolveProcessOpen(isStreaming, processOpenOverride)
  const processLabelCount = visibleBlocks.length > 0 ? visibleBlocks.length : processCount
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
              {visibleBlocks.map(block => <ProcessBlock key={block.id} block={block} />)}
              {visibleBlocks.length === 0 && stage && <div style={styles.processState}>{stage}</div>}
              {processLoading && <div style={styles.processState}>正在加载执行过程...</div>}
              {processError && <div style={{ ...styles.processState, color: 'var(--error)' }}>{processError}</div>}
              {!processLoading && !processError && visibleBlocks.length === 0 && !stage && (
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
              pre: ({ children }) => <pre style={styles.codePre}>{children}</pre>,
              code: ({ children }) => <code style={styles.codeInline}>{children}</code>,
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

      {!isStreaming && fileChanges.length > 0 && <FileChangesCard files={fileChanges} />}

      {showStats && (
        <div style={styles.stats}>
          {elapsedSeconds != null && (
            <span style={styles.statItem}><Clock size={11} /> {elapsedSeconds}s</span>
          )}
          {turnStats?.inputTokens != null && (
            <span style={styles.statItem}><Zap size={11} /> {formatTokens(turnStats.inputTokens + (turnStats.outputTokens ?? 0))}</span>
          )}
          {turnStats?.costAmount != null && (
            <span style={styles.statItem}><DollarSign size={11} /> ${turnStats.costAmount.toFixed(4)}</span>
          )}
        </div>
      )}
    </div>
  )
}

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
  codePre: {
    margin: '8px 0',
    padding: '8px 10px',
    borderRadius: 6,
    background: '#1e1e2e',
    color: '#cdd6f4',
    fontSize: 12,
    lineHeight: 1.5,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
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
