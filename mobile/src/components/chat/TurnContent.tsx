import { useState, useMemo, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronRight, Clock, Zap, DollarSign } from 'lucide-react'
import type { MessageData } from '@desktop/stores/session-events'
import type { TurnViewModel } from '@desktop/stores/turn-blocks'
import ProcessBlock from './ProcessBlock'
import FileChangesCard, { extractFileChangesFromBlocks } from './FileChangesCard'

interface Props {
  message?: MessageData
  streaming?: TurnViewModel | null
}

export default function TurnContent({ message, streaming }: Props) {
  const [processOpen, setProcessOpen] = useState(false)

  const processBlocks = streaming?.processBlocks ?? message?.processBlocks ?? []
  const finalAnswer = streaming?.finalAnswer ?? message?.finalAnswer ?? message?.content ?? ''
  const isStreaming = !!streaming && !streaming.done
  const stage = streaming?.stage
  const turnStats = useMemo(() => parseTurnStats(message?.decision_json), [message?.decision_json])
  const visibleBlocks = processBlocks.filter(b => b.kind !== 'stage')
  const fileChanges = useMemo(() => extractFileChangesFromBlocks(processBlocks), [processBlocks])

  return (
    <div>
      {visibleBlocks.length > 0 && (
        <div style={styles.processSection}>
          <button style={styles.processToggle} onClick={() => setProcessOpen(!processOpen)}>
            {processOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span style={styles.processLabel}>执行过程 ({visibleBlocks.length})</span>
          </button>
          {processOpen && (
            <div style={styles.processList}>
              {visibleBlocks.map(block => <ProcessBlock key={block.id} block={block} />)}
            </div>
          )}
        </div>
      )}

      {stage && !finalAnswer && (
        <div style={styles.stageIndicator}>{stage}</div>
      )}

      {finalAnswer && (
        <div style={styles.markdownWrap}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <pre style={styles.codePre}>{children}</pre>,
              code: ({ children }) => <code style={styles.codeInline}>{children}</code>,
            }}
          >
            {finalAnswer}
          </ReactMarkdown>
        </div>
      )}

      {!isStreaming && fileChanges.length > 0 && <FileChangesCard files={fileChanges} />}

      {!isStreaming && turnStats && (
        <div style={styles.stats}>
          {turnStats.elapsedSeconds != null && (
            <span style={styles.statItem}><Clock size={11} /> {turnStats.elapsedSeconds}s</span>
          )}
          {turnStats.inputTokens != null && (
            <span style={styles.statItem}><Zap size={11} /> {formatTokens(turnStats.inputTokens + (turnStats.outputTokens ?? 0))}</span>
          )}
          {turnStats.costAmount != null && (
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
