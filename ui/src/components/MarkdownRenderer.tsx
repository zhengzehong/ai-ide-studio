import { memo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { useFileAssetUrl } from './file-viewer/use-file-asset-url'

interface MarkdownRendererProps {
  content: string
  projectId?: string
  documentPath?: string
}

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

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, projectId, documentPath }: MarkdownRendererProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        urlTransform={(url, key) => key === 'src' ? url : defaultUrlTransform(url)}
        components={{
          a: ({ href, children }) => (
            <a href={href || '#'} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => projectId && documentPath && src
            ? <MarkdownAssetImage key={src} projectId={projectId} documentPath={documentPath} src={src} alt={alt ?? ''} />
            : <img src={src} alt={alt ?? ''} referrerPolicy="no-referrer" />,
          table: ({ children }) => (
            <div className="markdown-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

function MarkdownAssetImage({ projectId, documentPath, src, alt }: {
  projectId: string
  documentPath: string
  src: string
  alt: string
}) {
  const asset = useFileAssetUrl(projectId, src, { basePath: documentPath })
  const [retried, setRetried] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span style={{ display: 'block', color: 'var(--text-3)' }}>
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
        style={{ display: asset.url && !failed ? 'block' : 'none', maxWidth: '100%', height: 'auto' }}
      />
    </span>
  )
}
