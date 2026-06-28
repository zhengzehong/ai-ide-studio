import { useState, type CSSProperties } from 'react'
import { ArrowLeft, Copy, Check, FileText, AlertCircle, Download } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import { MarkdownView } from './MarkdownView'
import { CodeView } from './CodeView'
import { PlainTextView } from './PlainTextView'
import { ImageView } from './ImageView'
import { BinaryFileView } from './BinaryFileView'

const MARKDOWN_EXTS = ['.md', '.mdx']
const CODE_EXTS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.py', '.rs', '.go', '.java', '.kt',
  '.yaml', '.yml', '.toml', '.html', '.css', '.scss', '.less',
  '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.xml', '.svg', '.vue', '.svelte',
  '.graphql', '.gql', '.dockerfile',
]

interface FileDetailProps {
  file: FileContent
  loading: boolean
  error: string | null
  onBack: () => void
}

export function FileDetail({ file, loading, error, onBack }: FileDetailProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(file.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const ext = file.extension.toLowerCase()
  const isMarkdown = MARKDOWN_EXTS.includes(ext)
  const isCode = !isMarkdown && (
    CODE_EXTS.includes(ext) ||
    (!!file.language && file.language !== 'plaintext' && file.language !== 'markdown')
  )
  const kind = file.kind ?? 'text'
  const showCopyButton = kind === 'text' && !loading && !error

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.iconBtn} onClick={onBack} aria-label="返回">
          <ArrowLeft size={20} />
        </button>
        <FileText size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <div style={styles.titleWrap}>
          <span style={styles.title}>{file.path.split('/').pop() || file.path}</span>
          <span style={styles.subtitle}>
            {formatSize(file.size)} · {file.language || kind}
          </span>
        </div>
        {showCopyButton && (
          <button style={styles.iconBtn} onClick={handleCopy} aria-label="复制">
            {copied ? <Check size={18} color="var(--success)" /> : <Copy size={18} />}
          </button>
        )}
        {kind !== 'text' && !loading && !error && (
          <button style={styles.iconBtn} onClick={() => BinaryFileView.download(file)} aria-label="下载">
            <Download size={18} />
          </button>
        )}
      </div>

      {file.truncated && (
        <div style={styles.truncateBanner}>
          文件过大,仅显示前 1MB 内容
        </div>
      )}

      <div style={styles.content}>
        {loading ? (
          <div style={styles.loading}>读取中...</div>
        ) : error ? (
          <div style={styles.errorWrap}>
            <AlertCircle size={32} color="var(--error)" />
            <span style={styles.errorText}>{error}</span>
          </div>
        ) : kind === 'image' ? (
          <ImageView file={file} />
        ) : kind === 'binary' ? (
          <BinaryFileView file={file} />
        ) : isMarkdown ? (
          <MarkdownView content={file.content} />
        ) : isCode ? (
          <CodeView content={file.content} language={file.language} />
        ) : (
          <PlainTextView content={file.content} />
        )}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-card)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 1,
  },
  truncateBanner: {
    padding: '6px 12px',
    background: '#fef3c7',
    color: 'var(--warning)',
    fontSize: 13,
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 40,
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  errorWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: 60,
    color: 'var(--text-muted)',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    color: 'var(--text-muted)',
  },
}
