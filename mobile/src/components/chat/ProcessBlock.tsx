import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wrench, Brain, FileText, ChevronDown, ChevronRight, AlertCircle, Loader } from 'lucide-react'
import type { TurnProcessBlock } from '@desktop/stores/turn-blocks'
import PreviewCard from './PreviewCard'
import { isPreviewPublishTool, parsePreviewPublishOutput } from '../../utils/preview-tool'

export default function ProcessBlock({ block }: { block: TurnProcessBlock }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()

  if (block.kind === 'stage') {
    return (
      <div style={styles.stageRow}>
        <Loader size={12} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={styles.stageText}>{block.text}</span>
      </div>
    )
  }

  if (block.kind === 'thinking') {
    return (
      <div style={styles.block}>
        <button style={styles.header} onClick={() => setExpanded(!expanded)}>
          <Brain size={13} color="var(--primary-light)" />
          <span style={styles.label}>思考中</span>
          {expanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
        </button>
        {expanded && <div style={styles.detail}>{block.text}</div>}
      </div>
    )
  }

  if (block.kind === 'tool') {
    const tc = block.toolCall
    if (isPreviewPublishTool(tc.title)) {
      const preview = parsePreviewPublishOutput(tc.rawOutput)
      if (preview) {
        return <PreviewCard preview={preview} onOpen={(id) => navigate(`/preview/${id}?target=${preview.target}`)} />
      }
      return null
    }
    const isError = !!tc.error
    const isPending = tc.status === 'pending' || tc.status === 'in_progress'
    return (
      <div style={styles.block}>
        <button style={styles.header} onClick={() => setExpanded(!expanded)}>
          {isError ? <AlertCircle size={13} color="var(--error)" /> : <Wrench size={13} color="var(--info)" />}
          <span style={{ ...styles.label, color: isError ? 'var(--error)' : 'var(--text-secondary)' }}>
            {tc.title || '工具调用'}
          </span>
          {isPending && <Loader size={12} color="var(--info)" style={{ animation: 'spin 1s linear infinite' }} />}
          {expanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
        </button>
        {expanded && (
          <div style={styles.detail}>
            {tc.error && <div style={{ color: 'var(--error)', marginBottom: 4 }}>{tc.error}</div>}
            {tc.content?.map((item, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                {item.path && <div style={styles.path}>{item.path}</div>}
                {item.text && <pre style={styles.pre}>{item.text.slice(0, 500)}</pre>}
              </div>
            ))}
            {tc.terminalOutput && <pre style={styles.pre}>{tc.terminalOutput.slice(0, 500)}</pre>}
          </div>
        )}
      </div>
    )
  }

  if (block.kind === 'note') {
    return (
      <div style={styles.block}>
        <div style={styles.header}>
          <FileText size={13} color="var(--text-muted)" />
          <span style={styles.label}>{block.text.slice(0, 80)}</span>
        </div>
      </div>
    )
  }

  if (block.kind === 'file_change') {
    return (
      <div style={styles.block}>
        <div style={styles.header}>
          <FileText size={13} color="var(--warning)" />
          <span style={styles.label}>{block.summary || '文件变更'}</span>
        </div>
      </div>
    )
  }

  return null
}

const styles: Record<string, CSSProperties> = {
  stageRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
  },
  stageText: {
    fontSize: 12,
    color: 'var(--primary)',
    fontWeight: 500,
  },
  block: {
    marginBottom: 4,
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 0',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
  },
  label: {
    flex: 1,
    fontSize: 12,
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  detail: {
    padding: '6px 0 6px 19px',
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  path: {
    fontSize: 11,
    color: 'var(--info)',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  pre: {
    margin: 0,
    padding: '6px 8px',
    borderRadius: 4,
    background: 'var(--bg)',
    fontSize: 11,
    lineHeight: 1.4,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 200,
    fontFamily: 'monospace',
  },
}
