import type { ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { FileChangesCard } from './FileChangesCard'
import { FilesPresentationCard } from './FilesPresentationCard'
import { PreviewCard } from './PreviewCard'
import { extractFileChangesFromToolCall, toolBlockHasDiff } from './file-changes-utils'
import { processBlockNeedsDetail, useProcessThinkingDisclosure } from './process-detail'
import { isFilesPresentationToolCall, parseFilesPresentationOutput, type FilesPresentationInfo, type PreviewPresentationInfo } from '../../stores/session-events'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import { isPreviewPublishTool, parsePreviewPublishOutput } from '../../pages/workspace/helpers'
import { toolSummary } from '../../pages/workspace/helpers'

export interface ConversationProcessBlockProps {
  block: TurnProcessBlock
  isStreaming?: boolean
  detailLoading?: boolean
  detailError?: string
  onLoadDetail?: () => void
  onOpenPreview?: (preview: PreviewPresentationInfo) => void
  onOpenFiles?: (presentation: FilesPresentationInfo) => void
}

export function ConversationProcessBlock({
  block,
  isStreaming = false,
  detailLoading = false,
  detailError,
  onLoadDetail,
  onOpenPreview,
  onOpenFiles,
}: ConversationProcessBlockProps): ReactNode {
  const needsDetail = processBlockNeedsDetail(block)
  const thinkingDisclosure = useProcessThinkingDisclosure(isStreaming)
  const thinkingContentId = useId()
  useEffect(() => {
    if (needsDetail && block.kind !== 'tool' && !detailLoading && !detailError) onLoadDetail?.()
  }, [block.kind, detailError, detailLoading, needsDetail, onLoadDetail])

  if (block.kind === 'tool') {
    if (isPreviewPublishTool(block.toolCall.title)) {
      const parsed = parsePreviewPublishOutput(block.toolCall.rawOutput)
      return parsed && onOpenPreview ? <PreviewCard preview={{ ...parsed, taskId: parsed.taskId ?? null }} onOpen={() => onOpenPreview({ kind: 'preview', ...parsed, taskId: parsed.taskId ?? null })} /> : null
    }
    if (isFilesPresentationToolCall(block.toolCall)) {
      const presentation = parseFilesPresentationOutput(block.toolCall.rawOutput)
      return presentation && onOpenFiles ? <FilesPresentationCard presentation={presentation} onOpen={onOpenFiles} /> : null
    }
    const diffEntries = toolBlockHasDiff(block.toolCall) ? extractFileChangesFromToolCall(block.toolCall) : []
    return <ConversationToolCall block={block} detailLoading={detailLoading} detailError={detailError} onLoadDetail={onLoadDetail} diffEntries={diffEntries} />
  }
  if (block.kind === 'thinking') return <div className="conversation-process-thinking">
    <button type="button" className="conversation-process-thinking-header process-thinking-toggle" aria-expanded={thinkingDisclosure.open} aria-controls={thinkingContentId} onClick={thinkingDisclosure.toggle}>
      {thinkingDisclosure.open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      <span>思考过程</span>
      {isStreaming && <Loader2 size={10} className="conversation-process-thinking-spinner" />}
    </button>
    {thinkingDisclosure.open && <div id={thinkingContentId} className="conversation-process-thinking-body"><MarkdownRenderer content={block.text} /></div>}
  </div>
  if (block.kind === 'file_change') return block.changes ? <FileChangesCard compact changes={block.changes} /> : <ProcessDetailCard title="文件修改" summary={block.summary} loading={detailLoading} error={detailError} />
  if (block.kind === 'plan') return <PlanProcessCard block={block} loading={detailLoading} error={detailError} />
  if (block.kind === 'permission') return <PermissionProcessCard block={block} loading={detailLoading} error={detailError} />
  if (block.kind === 'elicitation') return <ProcessDetailCard title="AI 提问" summary={block.message || block.summary || block.preview || '需要补充信息'} loading={detailLoading} error={detailError} />
  if (block.kind === 'note') return <div className="conversation-process-note">
    <div className="conversation-process-note-title">中间说明</div>
    <div className="conversation-process-note-body"><MarkdownRenderer content={block.text} /></div>
  </div>
  if (block.kind === 'stage') return <div className="conversation-process-item">{block.text}</div>
  return null
}

function ConversationToolCall({ block, detailLoading, detailError, onLoadDetail, diffEntries }: { block: Extract<TurnProcessBlock, { kind: 'tool' }>; detailLoading: boolean; detailError?: string; onLoadDetail?: () => void; diffEntries: ReturnType<typeof extractFileChangesFromToolCall> }): ReactNode {
  const tool = block.toolCall
  const active = tool.status === 'in_progress' || tool.status === 'pending'
  const [override, setOverride] = useState<'open' | 'closed' | null>(null)
  const previousStatus = useRef(tool.status)
  const open = override === 'open' || (override !== 'closed' && active)
  const detailText = tool.terminalOutput || ''
  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = tool.status
    if ((previous === 'in_progress' || previous === 'pending') && tool.status === 'completed') setOverride((value) => value === 'open' ? 'open' : 'closed')
  }, [tool.status])
  useEffect(() => {
    if (open && block.hasDetail && !detailLoading && !detailError) onLoadDetail?.()
  }, [block.hasDetail, detailError, detailLoading, onLoadDetail, open])
  const toggle = (): void => setOverride(open ? 'closed' : 'open')
  const statusColor = tool.status === 'completed' ? 'var(--green)' : tool.status === 'failed' ? 'var(--red)' : 'var(--blue)'
  const statusIcon = tool.status === 'completed' ? <Check size={10} /> : tool.status === 'failed' ? <X size={10} /> : <Loader2 size={10} style={{ animation: 'conversation-spin 1s linear infinite' }} />
  const statusText = tool.status === 'completed' ? '完成' : tool.status === 'failed' ? '失败' : tool.status === 'in_progress' ? '执行中' : '等待'
  return <div className="conversation-tool-call">
    <button type="button" className="conversation-tool-call-header" onClick={toggle}>
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}<Wrench size={12} />
      <span className="conversation-tool-call-summary">{toolSummary(tool)}</span>
      <span className="conversation-tool-call-status" style={{ color: statusColor }}>{statusIcon} {statusText}</span>
    </button>
    {open && <div className="conversation-tool-call-detail">
      {detailLoading && <div className="conversation-tool-detail-state">正在加载工具详情...</div>}
      {detailError && <div className="conversation-process-error">{detailError}</div>}
      {tool.locations?.map((location, index) => <span className="conversation-tool-location" key={`${location.path}-${index}`}>{location.path}{location.line ? `:${location.line}` : ''}</span>)}
      {tool.rawInput != null && <ToolDetailSection title="参数" content={formatValue(tool.rawInput)} />}
      {tool.content?.map((item, index) => <ToolContentSection key={`${item.type}-${index}`} item={item} />)}
      {tool.rawOutput != null && <ToolDetailSection title="结果" content={formatValue(tool.rawOutput)} />}
      {detailText && <ToolDetailSection title="终端输出" content={detailText.slice(-2000)} dark />}
      {tool.progress?.length ? <ToolDetailSection title="进度" content={tool.progress.slice(-6).map((item) => `• ${item}`).join('\n')} /> : null}
      {tool.error && <div className="conversation-process-error">{tool.error}</div>}
      {diffEntries.length > 0 && <FileChangesCard compact changes={{ files: diffEntries, totalAdded: diffEntries.reduce((sum, file) => sum + file.addedLines, 0), totalDeleted: diffEntries.reduce((sum, file) => sum + file.deletedLines, 0) }} />}
    </div>}
  </div>
}

function ToolDetailSection({ title, content, truncated, dark = false }: { title: string; content: string; truncated?: boolean; dark?: boolean }): ReactNode {
  return <div className="conversation-tool-detail-section"><div>{title}{truncated ? '（已截断）' : ''}</div><pre className={dark ? 'is-dark' : undefined}>{content}</pre></div>
}

function ToolContentSection({ item }: { item: NonNullable<Extract<TurnProcessBlock, { kind: 'tool' }>['toolCall']['content']>[number] }): ReactNode {
  if (item.type === 'diff' && item.path) return <div className="conversation-tool-detail-section"><div>{item.path}</div><pre><span className="conversation-diff-removed">{item.oldText ? `- ${item.oldText.slice(0, 200)}\n` : ''}</span><span className="conversation-diff-added">{item.newText ? `+ ${item.newText.slice(0, 200)}` : ''}</span></pre></div>
  if (item.type === 'text' && item.text) return <ToolDetailSection title="输出" content={item.text.slice(0, 500)} />
  return null
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 500)
  try { return JSON.stringify(value, null, 2).slice(0, 500) } catch { return String(value) }
}

function PlanProcessCard({ block, loading, error }: { block: Extract<TurnProcessBlock, { kind: 'plan' }>; loading: boolean; error?: string }): ReactNode {
  return <div className="conversation-process-item"><strong>计划</strong>{loading && <span className="conversation-process-detail-state"><Loader2 size={12} /> 正在加载详情...</span>}{error && <span className="conversation-process-error">{error}</span>}{block.summary && <div>{block.summary}</div>}{block.plan.length > 0 && <div className="conversation-plan-list">{block.plan.map((item, index) => <div key={`${item.content}-${index}`}><span className={`conversation-plan-status is-${item.status}`}>{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}</span><span>{item.content}</span></div>)}</div>}</div>
}

function PermissionProcessCard({ block, loading, error }: { block: Extract<TurnProcessBlock, { kind: 'permission' }>; loading: boolean; error?: string }): ReactNode {
  return <ProcessDetailCard title="权限请求" summary={block.summary || block.request?.toolCall.title || '需要确认工具权限'} loading={loading} error={error} detail={block.preview || block.request?.options.map((option) => option.name).join(' / ')} />
}

function ProcessDetailCard({ title, summary, loading, error, detail }: { title: string; summary?: string; loading: boolean; error?: string; detail?: string }): ReactNode {
  return <div className="conversation-process-item"><strong>{title}</strong>{loading && <span className="conversation-process-detail-state"><Loader2 size={12} /> 正在加载详情...</span>}{error && <span className="conversation-process-error">{error}</span>}{summary && <div>{summary}</div>}{detail && <div>{detail}</div>}</div>
}
