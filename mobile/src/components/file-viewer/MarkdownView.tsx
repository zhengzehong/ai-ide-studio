import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { type CSSProperties } from 'react'
import { CodeView } from './CodeView'

export function MarkdownView({ content }: { content: string }) {
  return (
    <div style={styles.container}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
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
}
