import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { resolveReadingAssetUrl } from '../../services/reading-client'

interface ReadingMarkdownProps {
  content: string
  assetBaseUrl: string
}

export function ReadingMarkdown({ content, assetBaseUrl }: ReadingMarkdownProps) {
  return (
    <div className="reading-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={(url, key) => {
          if ((key === 'src' || key === 'href') && !/^(?:https?:|mailto:|tel:|data:|blob:|#)/i.test(url)) {
            return resolveReadingAssetUrl(url, assetBaseUrl)
          }
          return defaultUrlTransform(url)
        }}
        components={{
          a: ({ href, children }) => <a href={href || '#'} target="_blank" rel="noreferrer">{children}</a>,
          img: ({ src, alt }) => <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />,
          table: ({ children }) => <div className="reading-table-scroll"><table>{children}</table></div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
