import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { useState, type CSSProperties } from 'react'
import { CodeView } from './CodeView'
import { useMobileFileAssetUrl } from './use-mobile-file-asset-url'

const driveProtocols = Array.from({ length: 26 }, (_, index) => [
  String.fromCharCode(65 + index),
  String.fromCharCode(97 + index),
]).flat()
const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'file', ...driveProtocols],
  },
}

export function MarkdownView({ content, projectId, documentPath }: {
  content: string
  projectId: string
  documentPath: string
}) {
  return (
    <div style={styles.container}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        urlTransform={(url, key) => key === 'src' ? url : defaultUrlTransform(url)}
        components={{
          code({ className, children, ...props }) {
            const text = String(children ?? '')
            const match = /language-(\w+)/.exec(className || '')
            const lang = match?.[1] || 'text'
            const isInline = !className && !text.includes('\n')
            if (isInline) {
              return <code style={styles.inlineCode} {...props}>{children}</code>
            }
            return <CodeView content={text.replace(/\n$/, '')} language={lang} embedded />
          },
          a({ children, href, ...props }) {
            return (
              <a href={href} target="_blank" rel="noreferrer" style={styles.link} {...props}>
                {children}
              </a>
            )
          },
          img({ src, alt }) {
            return src
              ? <MarkdownAssetImage key={src} projectId={projectId} documentPath={documentPath} src={src} alt={alt ?? ''} />
              : null
          },
          table({ children, ...props }) {
            return (
              <div style={styles.tableWrap}>
                <table style={styles.table} {...props}>{children}</table>
              </div>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function MarkdownAssetImage({ projectId, documentPath, src, alt }: {
  projectId: string
  documentPath: string
  src: string
  alt: string
}) {
  const asset = useMobileFileAssetUrl(projectId, src, { basePath: documentPath })
  const [retried, setRetried] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span style={styles.imageState}>
      {(!asset.url || failed) && (asset.error || alt || '图片加载失败')}
      <img
        src={asset.url || undefined}
        alt={alt}
        data-resource-path={src}
        referrerPolicy="no-referrer"
        onError={() => {
          if (retried) {
            setFailed(true)
            return
          }
          setRetried(true)
          asset.refresh()
        }}
        style={{ ...styles.image, display: asset.url && !failed ? 'block' : 'none' }}
      />
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    padding: 16,
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  },
  inlineCode: {
    background: 'var(--bg-input)',
    padding: '1px 5px',
    borderRadius: 4,
    fontFamily: 'var(--font-mono, "Fira Code", monospace)',
    fontSize: 13,
  },
  link: {
    color: 'var(--primary)',
    textDecoration: 'none',
  },
  tableWrap: {
    overflowX: 'auto',
    margin: '8px 0',
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 14,
  },
  image: {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
    margin: '12px auto',
  },
  imageState: {
    display: 'inline-block',
    padding: 8,
    color: 'var(--text-muted)',
  },
}
