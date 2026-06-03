import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import { MarkdownRenderer } from '../MarkdownRenderer'

interface TurnContentViewProps {
  processBlocks: TurnProcessBlock[]
  finalAnswer: string
  isStreaming: boolean
  fallbackStage?: string
  processCount?: number
  processLoaded?: boolean
  processLoading?: boolean
  processError?: string
  defaultProcessOpen?: boolean
  onLoadProcess?: () => void
  renderProcessBlock: (block: TurnProcessBlock) => ReactNode
}

export function TurnContentView({
  processBlocks,
  finalAnswer,
  isStreaming,
  fallbackStage,
  processCount,
  processLoaded = true,
  processLoading = false,
  processError,
  defaultProcessOpen = isStreaming,
  onLoadProcess,
  renderProcessBlock,
}: TurnContentViewProps) {
  const [processOpenOverride, setProcessOpenOverride] = useState<'open' | 'closed' | null>(null)
  const processOpen = processOpenOverride === 'open' || (processOpenOverride !== 'closed' && defaultProcessOpen)
  const canLoadProcess = !processLoaded && !!onLoadProcess
  const hasProcess = processBlocks.length > 0 || !!fallbackStage || canLoadProcess

  useEffect(() => {
    if (processOpen && canLoadProcess && !processLoading) onLoadProcess()
  }, [canLoadProcess, onLoadProcess, processLoading, processOpen])

  return (
    <div>
      {hasProcess && (
        <div style={{ marginBottom: finalAnswer ? 10 : 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-1)' }}>
          <button
            type="button"
            onClick={() => setProcessOpenOverride(processOpen ? 'closed' : 'open')}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              color: 'var(--text-2)',
              fontSize: 14,
              textAlign: 'left',
            }}
          >
            {processOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span style={{ fontWeight: 600 }}>执行过程</span>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{processLabel(processBlocks.length, processCount, fallbackStage)}</span>
            {(isStreaming || processLoading) && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
          </button>
          {processOpen && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {processBlocks.length === 0 && fallbackStage && (
                <div style={{ fontSize: 14, color: 'var(--text-3)' }}>{fallbackStage}</div>
              )}
              {processBlocks.map((block) => renderProcessBlock(block))}
              {processLoading && <div style={{ fontSize: 14, color: 'var(--text-3)' }}>正在加载执行过程...</div>}
              {processError && <div style={{ fontSize: 14, color: 'var(--red)', overflowWrap: 'anywhere' }}>{processError}</div>}
              {processLoaded && processBlocks.length === 0 && !fallbackStage && !processError && (
                <div style={{ fontSize: 14, color: 'var(--text-3)' }}>暂无可恢复的执行过程</div>
              )}
            </div>
          )}
        </div>
      )}
      {finalAnswer && <MarkdownRenderer content={finalAnswer} />}
    </div>
  )
}

function processLabel(blockCount: number, processCount?: number, fallbackStage?: string): string {
  if (blockCount > 0) return `${blockCount} 项`
  if (processCount != null && processCount > 0) return `${processCount} 项`
  return fallbackStage || '点击加载'
}
