import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
        a: ({ href, children }) => (
          <a href={href || '#'} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
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
}
