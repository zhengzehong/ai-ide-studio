import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, FileText, Loader2 } from 'lucide-react'
import type { FileChangeEntry, TurnFileChanges } from './file-changes-utils'
import { styles } from './file-changes-card-styles'
import { MarkdownRenderer } from '../MarkdownRenderer'

interface FileChangesCardProps {
  changes: TurnFileChanges
  compact?: boolean
  defaultExpanded?: boolean
  cardRef?: React.Ref<HTMLDivElement>
  loading?: boolean
  error?: string
  onExpand?: () => void
}

export function FileChangesCard({
  changes,
  compact = false,
  defaultExpanded = false,
  cardRef,
  loading = false,
  error,
  onExpand,
}: FileChangesCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const summary = useMemo(() => buildSummary(changes), [changes])

  useEffect(() => {
    if (expanded) onExpand?.()
  }, [expanded, onExpand])

  if (changes.files.length === 0) return null

  if (compact) {
    return (
      <div style={styles.compactRoot}>
        <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{summary.label}</span>
        <ChangeStats changes={changes} />
      </div>
    )
  }

  return (
    <div ref={cardRef} data-file-changes-card style={styles.card}>
      <button
        type="button"
        style={styles.header}
        onClick={() => setExpanded((value) => !value)}
      >
        <div style={styles.iconBox}>
          <FileText size={16} style={{ color: 'var(--green)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={styles.title}>{summary.label}</div>
          <div style={{ marginTop: 2 }}>
            <ChangeStats changes={changes} />
          </div>
        </div>
        {loading ? (
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-3)' }} />
        ) : (
          <ChevronRight
            size={12}
            style={{ color: 'var(--text-3)', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none' }}
          />
        )}
        <span style={styles.viewText}>{expanded ? '收起变更' : '查看变更'}</span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {error && <div style={styles.errorText}>{error}</div>}
          {changes.files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
          {loading && <div style={styles.loadingText}>正在加载变更详情...</div>}
        </div>
      )}
    </div>
  )
}

function ChangeStats({ changes }: { changes: TurnFileChanges }) {
  return (
    <span style={{ fontSize: 12 }}>
      <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{changes.totalAdded}</span>
      {' '}
      <span style={{ color: 'var(--red)', fontWeight: 600 }}>-{changes.totalDeleted}</span>
    </span>
  )
}

function isMarkdownFile(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path)
}

function getFullNewText(file: FileChangeEntry): string {
  return file.segments.map((s) => s.newText ?? '').join('\n')
}

function FileRow({ file }: { file: FileChangeEntry }) {
  const isMd = isMarkdownFile(file.path)
  const [expanded, setExpanded] = useState(false)
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>(isMd ? 'preview' : 'diff')
  const hasDiffContent = file.segments.some((segment) => segment.lines.length > 0)
  const canExpand = hasDiffContent || (isMd && getFullNewText(file).length > 0)

  return (
    <>
      <button
        type="button"
        style={{ ...styles.fileRow, ...(expanded ? { background: 'var(--bg-2)' } : {}) }}
        onClick={canExpand ? () => setExpanded(!expanded) : undefined}
        disabled={!canExpand}
      >
        <ChangeTypeBadge type={file.changeType} />
        <span style={styles.filePath}>{shortPath(file.path)}</span>
        <span style={styles.fileStat}>
          {file.addedLines > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{file.addedLines}</span>}
          {file.deletedLines > 0 && <span style={{ color: 'var(--red)', fontWeight: 600 }}>-{file.deletedLines}</span>}
        </span>
        {canExpand && (
          <ChevronRight
            size={10}
            style={{ color: 'var(--text-3)', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none', flexShrink: 0 }}
          />
        )}
      </button>
      {expanded && (
        <>
          {isMd && hasDiffContent && (
            <div style={{ display: 'flex', gap: 2, padding: '6px 14px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }}>
              <button type="button" onClick={() => setViewMode('preview')} style={{ padding: '3px 10px', borderRadius: 5, border: viewMode === 'preview' ? '1px solid var(--blue)' : '1px solid var(--border)', background: viewMode === 'preview' ? 'var(--blue-light)' : 'var(--bg-0)', color: viewMode === 'preview' ? 'var(--blue)' : 'var(--text-2)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>预览</button>
              <button type="button" onClick={() => setViewMode('diff')} style={{ padding: '3px 10px', borderRadius: 5, border: viewMode === 'diff' ? '1px solid var(--blue)' : '1px solid var(--border)', background: viewMode === 'diff' ? 'var(--blue-light)' : 'var(--bg-0)', color: viewMode === 'diff' ? 'var(--blue)' : 'var(--text-2)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>Diff</button>
            </div>
          )}
          {viewMode === 'preview' && isMd ? (
            <MarkdownPreviewPanel content={getFullNewText(file)} />
          ) : hasDiffContent ? (
            <InlineDiffView file={file} />
          ) : null}
        </>
      )}
    </>
  )
}

function MarkdownPreviewPanel({ content }: { content: string }) {
  return (
    <div style={{ padding: '14px 18px', maxHeight: 500, overflowY: 'auto', background: 'var(--bg-0)', borderTop: '1px solid var(--border)' }}>
      <MarkdownRenderer content={content} />
    </div>
  )
}

function ChangeTypeBadge({ type }: { type: FileChangeEntry['changeType'] }) {
  const config = badgeConfig[type]
  return (
    <span style={{ ...styles.badge, background: config.bg, color: config.fg }}>
      {type}
    </span>
  )
}

const badgeConfig: Record<string, { bg: string; fg: string }> = {
  M: { bg: '#fef3c7', fg: '#d97706' },
  A: { bg: '#dcfce7', fg: '#16a34a' },
  D: { bg: '#fef2f2', fg: '#dc2626' },
  '?': { bg: '#f3f4f6', fg: '#6b7280' },
}

function InlineDiffView({ file }: { file: FileChangeEntry }) {
  return (
    <div style={styles.diffPanel}>
      <div style={styles.diffHunkHeader}>{file.path}</div>
      {file.segments.map((segment, segmentIndex) => (
        <div key={`${segment.toolCallId}-${segmentIndex}`}>
          {file.segments.length > 1 && (
            <div style={styles.diffSegmentHeader}>
              第 {segmentIndex + 1} 次修改
            </div>
          )}
          {segment.lines.map((line, lineIndex) => (
            <div key={lineIndex} style={{ ...styles.diffLine, ...(line.type === 'add' ? styles.diffAdd : line.type === 'del' ? styles.diffDel : styles.diffCtx) }}>
              <span style={{ ...styles.diffLineNum, ...(line.type === 'add' ? { color: '#4ade80' } : line.type === 'del' ? { color: '#f87171' } : {}) }}>
                {line.type === 'add' ? line.newLine : line.type === 'del' ? line.oldLine : line.newLine}
              </span>
              {line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}{line.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function shortPath(path: string): string {
  return path.replace(/^\/+/, '')
}

function buildSummary(changes: TurnFileChanges) {
  const modified = changes.files.filter((file) => file.changeType === 'M').length
  const added = changes.files.filter((file) => file.changeType === 'A').length
  const deleted = changes.files.filter((file) => file.changeType === 'D').length
  const parts: string[] = []
  if (modified > 0) parts.push(`修改 ${modified} 个文件`)
  if (added > 0) parts.push(`新增 ${added} 个文件`)
  if (deleted > 0) parts.push(`删除 ${deleted} 个文件`)
  if (parts.length === 0) parts.push(`变更 ${changes.files.length} 个文件`)
  return { label: parts.join(' · ') }
}
