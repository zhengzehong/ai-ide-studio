import { useState } from 'react'
import type { ReactElement } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Terminal, Wrench, X } from 'lucide-react'
import { useSessionStore, type ToolCallDetailInfo, type ToolCallSummaryInfo } from '../../stores/session.store'

interface LazyToolCallsBlockProps {
  sessionId: string
  messageId: string
  count?: number
}

function toolDetailKey(messageId: string, toolCallId: string): string {
  return `${messageId}:${toolCallId}`
}

function statusText(status?: string): string {
  if (status === 'completed') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'in_progress') return '执行中'
  return '等待'
}

function statusColor(status?: string): string {
  if (status === 'completed') return 'var(--green)'
  if (status === 'failed') return 'var(--red)'
  return 'var(--blue)'
}

function statusIcon(status?: string): ReactElement {
  if (status === 'completed') return <Check size={10} />
  if (status === 'failed') return <X size={10} />
  return <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
}

function kindIcon(kind?: string): ReactElement {
  return kind === 'execute' ? <Terminal size={12} /> : <Wrench size={12} />
}

function DetailPreview({ detail }: { detail: ToolCallDetailInfo }) {
  const sections = [
    { title: '参数', content: detail.rawInputPreview, truncated: detail.rawInputTruncated },
    { title: '结果', content: detail.rawOutputPreview, truncated: detail.rawOutputTruncated },
    { title: '终端输出', content: detail.terminalOutputTail, truncated: detail.terminalOutputTruncated, dark: true },
  ].filter((item) => item.content)

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {detail.locations && detail.locations.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {detail.locations.map((location, index) => (
            <span
              key={`${location.path}-${index}`}
              style={{
                maxWidth: '100%',
                padding: '2px 8px',
                borderRadius: 4,
                background: 'var(--bg-2)',
                fontSize: 12,
                color: 'var(--text-2)',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {location.path}{location.line ? `:${location.line}` : ''}
            </span>
          ))}
        </div>
      )}
      {detail.contentPreview && detail.contentPreview.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {detail.contentPreview.map((item, index) => (
            <div
              key={`${item.type}-${index}`}
              style={{
                background: 'var(--bg-2)',
                padding: 8,
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
                color: 'var(--text-2)',
              }}
            >
              {item.path && <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>{item.path}</div>}
              {item.text || item.oldText || item.newText || item.type}
            </div>
          ))}
          {detail.contentTruncated && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>内容已截断</div>}
        </div>
      )}
      {sections.map((section) => (
        <div key={section.title}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>
            {section.title}{section.truncated ? '（已截断）' : ''}
          </div>
          <div
            style={{
              background: section.dark ? '#0f172a' : 'var(--bg-2)',
              color: section.dark ? '#e2e8f0' : 'var(--text-2)',
              padding: 8,
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              maxWidth: '100%',
              overflow: 'auto',
              lineHeight: 1.5,
            }}
          >
            {section.content}
          </div>
        </div>
      ))}
      {detail.progressTail && detail.progressTail.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3, fontWeight: 600 }}>
            进度{detail.progressTruncated ? '（仅显示最近几条）' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {detail.progressTail.map((item, index) => (
              <div key={index} style={{ fontSize: 12, color: 'var(--text-2)' }}>• {item}</div>
            ))}
          </div>
        </div>
      )}
      {detail.error && <div style={{ fontSize: 12, color: 'var(--red)', overflowWrap: 'anywhere' }}>{detail.error}</div>}
    </div>
  )
}

function SummaryRow({
  summary,
  messageId,
  detail,
  loading,
  error,
  onToggle,
  open,
}: {
  summary: ToolCallSummaryInfo
  messageId: string
  detail?: ToolCallDetailInfo
  loading: boolean
  error?: string
  onToggle: () => void
  open: boolean
}) {
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textAlign: 'left',
          fontSize: 14,
          color: 'var(--text-1)',
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {kindIcon(summary.kind)}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
          {summary.title || summary.id}
        </span>
        <span
          style={{
            color: statusColor(summary.status),
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 12,
            flexShrink: 0,
            fontWeight: 500,
          }}
        >
          {loading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : statusIcon(summary.status)}
          {statusText(summary.status)}
        </span>
      </button>
      {summary.outputPreview && !open && (
        <div style={{ padding: '0 10px 8px 29px', fontSize: 13, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>
          {summary.outputPreview}
        </div>
      )}
      {open && (
        <div style={{ padding: '0 10px 10px 29px', fontSize: 13 }}>
          {loading && <div style={{ color: 'var(--text-3)' }}>正在加载工具详情...</div>}
          {error && <div style={{ color: 'var(--red)' }}>{error}</div>}
          {detail && <DetailPreview detail={{ ...detail, id: detail.id || toolDetailKey(messageId, summary.id) }} />}
        </div>
      )}
    </div>
  )
}

export function LazyToolCallsBlock({ sessionId, messageId, count }: LazyToolCallsBlockProps) {
  const [open, setOpen] = useState(false)
  const [openToolId, setOpenToolId] = useState<string | null>(null)
  const summaries = useSessionStore((state) => state.toolCallSummariesByMessageId[messageId])
  const details = useSessionStore((state) => state.toolCallDetailsByKey)
  const loadingByKey = useSessionStore((state) => state.toolCallLoadingByKey)
  const errorByKey = useSessionStore((state) => state.toolCallErrorByKey)
  const fetchMessageToolCalls = useSessionStore((state) => state.fetchMessageToolCalls)
  const fetchMessageToolCallDetail = useSessionStore((state) => state.fetchMessageToolCallDetail)

  const loadingSummaries = !!loadingByKey[messageId]
  const summaryError = errorByKey[messageId]

  const toggleOpen = () => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen && !summaries && !loadingSummaries) void fetchMessageToolCalls(sessionId, messageId)
  }

  const toggleTool = (toolId: string) => {
    const nextOpenToolId = openToolId === toolId ? null : toolId
    setOpenToolId(nextOpenToolId)
    if (nextOpenToolId) void fetchMessageToolCallDetail(sessionId, messageId, toolId)
  }

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 8,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: 'var(--bg-1)',
        maxWidth: '100%',
      }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-1)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textAlign: 'left',
          fontSize: 14,
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Wrench size={12} />
        <span style={{ flex: 1, fontWeight: 500 }}>
          工具调用 · {count != null ? `${count} 个` : '点击加载'}
        </span>
        {loadingSummaries && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}
      </button>
      {open && (
        <div>
          {summaryError && <div style={{ padding: '0 10px 8px', color: 'var(--red)', fontSize: 13 }}>{summaryError}</div>}
          {!summaries && !summaryError && (
            <div style={{ padding: '0 10px 8px', color: 'var(--text-3)', fontSize: 13 }}>
              {loadingSummaries ? '正在加载工具摘要...' : '暂无工具摘要'}
            </div>
          )}
          {summaries?.map((summary) => {
            const key = toolDetailKey(messageId, summary.id)
            return (
              <SummaryRow
                key={summary.id}
                summary={summary}
                messageId={messageId}
                detail={details[key]}
                loading={!!loadingByKey[key]}
                error={errorByKey[key]}
                open={openToolId === summary.id}
                onToggle={() => toggleTool(summary.id)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
