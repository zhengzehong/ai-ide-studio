import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import {
  isFilesPresentationToolCall,
  parseFilesPresentationOutput,
  type FileChangeDetailInfo,
  type FileChangeSummaryInfo,
  type FilesPresentationInfo,
  type PreviewPresentationInfo,
} from '../../stores/session-events'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { FileChangesCard } from './FileChangesCard'
import { extractTurnFileChanges, fileChangesFromSummary } from './file-changes-utils'
import { isPreviewPublishTool, parsePreviewPublishOutput } from '../../pages/workspace/helpers'
import type { OpenChatResource } from '../../services/chat-resource-links'

interface TurnContentViewProps {
  processBlocks: TurnProcessBlock[]
  finalAnswer: string
  isStreaming: boolean
  fallbackStage?: string
  processCount?: number
  processLoaded?: boolean
  processLoading?: boolean
  processError?: string
  fileChangesSummary?: FileChangeSummaryInfo
  fileChangesDetail?: FileChangeDetailInfo
  fileChangesLoading?: boolean
  fileChangesError?: string
  defaultProcessOpen?: boolean
  previewPresentations?: PreviewPresentationInfo[]
  filesPresentations?: FilesPresentationInfo[]
  onLoadProcess?: () => void
  onLoadFileChanges?: () => void
  onOpenResource?: OpenChatResource
  renderProcessBlock: (block: TurnProcessBlock, context: ProcessBlockRenderContext) => ReactNode
  renderPreviewPresentation?: (preview: PreviewPresentationInfo) => ReactNode
  renderFilesPresentation?: (presentation: FilesPresentationInfo) => ReactNode
}

export interface ProcessBlockRenderContext {
  thinkingActive: boolean
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
  fileChangesSummary,
  fileChangesDetail,
  fileChangesLoading = false,
  fileChangesError,
  defaultProcessOpen = isStreaming,
  previewPresentations = [],
  filesPresentations = [],
  onLoadProcess,
  onLoadFileChanges,
  onOpenResource,
  renderProcessBlock,
  renderPreviewPresentation,
  renderFilesPresentation,
}: TurnContentViewProps) {
  const [processOpenOverride, setProcessOpenOverride] = useState<'open' | 'closed' | null>(null)
  const processOpen = processOpenOverride === 'open' || (processOpenOverride !== 'closed' && defaultProcessOpen)
  const canLoadProcess = !processLoaded && !!onLoadProcess
  const visibleProcessBlocks = processBlocks.filter((block) => block.kind !== 'stage')
  const activeThinkingBlockId = isStreaming && !finalAnswer && visibleProcessBlocks.at(-1)?.kind === 'thinking'
    ? visibleProcessBlocks.at(-1)?.id
    : undefined
  // preview.publish 卡片优先级最高,turn 完成后无论是否折叠执行过程都要把卡片抽出来直接渲染。
  const previewBlocks = visibleProcessBlocks.filter(
    (block) => block.kind === 'tool' && isPreviewPublishTool(block.toolCall.title),
  )
  const realtimePreviewIds = new Set(previewBlocks.flatMap((block) => {
    if (block.kind !== 'tool') return []
    const parsed = parsePreviewPublishOutput(block.toolCall.rawOutput)
    return parsed ? [parsed.previewId] : []
  }))
  const persistedPreviews = previewPresentations.filter((preview) => !realtimePreviewIds.has(preview.previewId))
  const filesBlocks = visibleProcessBlocks.filter(
    (block) => block.kind === 'tool' && isFilesPresentationToolCall(block.toolCall),
  )
  const realtimeFilesIds = new Set(filesBlocks.flatMap((block) => {
    if (block.kind !== 'tool') return []
    const parsed = parseFilesPresentationOutput(block.toolCall.rawOutput)
    return parsed ? [parsed.presentationId] : []
  }))
  const persistedFiles = filesPresentations.filter(
    (presentation) => !realtimeFilesIds.has(presentation.presentationId),
  )
  const presentationBlocks = new Set([...previewBlocks, ...filesBlocks])
  const otherBlocks = visibleProcessBlocks.filter((block) => !presentationBlocks.has(block))
  const hasProcess = otherBlocks.length > 0 || !!fallbackStage || canLoadProcess
  const hasPreviewCard = previewBlocks.length > 0 || persistedPreviews.length > 0
  const hasFilesCard = filesBlocks.length > 0 || persistedFiles.length > 0

  const fileChanges = useMemo(() => {
    if (fileChangesDetail?.files.length) return fileChangesDetail
    if (fileChangesSummary?.files.length) return fileChangesFromSummary(fileChangesSummary)
    return extractTurnFileChanges(processBlocks)
  }, [fileChangesDetail, fileChangesSummary, processBlocks])
  const showBottomCard = !isStreaming && fileChanges.files.length > 0
  const bottomCardRef = useRef<HTMLDivElement>(null)

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
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{processLabel(otherBlocks.length, processCount, fallbackStage)}</span>
            {(isStreaming || processLoading) && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
          </button>
          {processOpen && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {otherBlocks.length === 0 && fallbackStage && (
                <div style={{ fontSize: 14, color: 'var(--text-3)' }}>{fallbackStage}</div>
              )}
              {otherBlocks.map((block) => renderProcessBlock(block, {
                thinkingActive: block.id === activeThinkingBlockId,
              }))}
              {processLoading && <div style={{ fontSize: 14, color: 'var(--text-3)' }}>正在加载执行过程...</div>}
              {processError && <div style={{ fontSize: 14, color: 'var(--red)', overflowWrap: 'anywhere' }}>{processError}</div>}
              {processLoaded && otherBlocks.length === 0 && !fallbackStage && !processError && (
                <div style={{ fontSize: 14, color: 'var(--text-3)' }}>暂无可恢复的执行过程</div>
              )}
            </div>
          )}
        </div>
      )}
      {finalAnswer && <MarkdownRenderer content={finalAnswer} onOpenResource={onOpenResource} />}
      {hasPreviewCard && (
        <div style={{ marginTop: finalAnswer ? 10 : 0 }}>
          {previewBlocks.map((block) => renderProcessBlock(block, { thinkingActive: false }))}
          {renderPreviewPresentation && persistedPreviews.map((preview) => (
            <div key={preview.previewId}>{renderPreviewPresentation(preview)}</div>
          ))}
        </div>
      )}
      {hasFilesCard && (
        <div style={{ marginTop: finalAnswer || hasPreviewCard ? 10 : 0 }}>
          {filesBlocks.map((block) => renderProcessBlock(block, { thinkingActive: false }))}
          {renderFilesPresentation && persistedFiles.map((presentation) => (
            <div key={presentation.presentationId}>{renderFilesPresentation(presentation)}</div>
          ))}
        </div>
      )}
      {showBottomCard && (
        <FileChangesCard
          changes={fileChanges}
          cardRef={bottomCardRef}
          loading={fileChangesLoading}
          error={fileChangesError}
          onExpand={onLoadFileChanges}
        />
      )}
    </div>
  )
}

function processLabel(blockCount: number, processCount?: number, fallbackStage?: string): string {
  if (blockCount > 0) return `${blockCount} 项`
  if (processCount != null && processCount > 0) return `${processCount} 项`
  return fallbackStage || '点击加载'
}
