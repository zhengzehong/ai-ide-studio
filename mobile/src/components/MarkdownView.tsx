import { type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { CodeView } from './file-viewer/CodeView'

interface Props {
  content: string
  compact?: boolean
}

export default function MarkdownView({ content, compact = false }: Props) {
  return (
    <div style={compact ? compactStyles.wrap : styles.wrap}>
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
          th({ children, ...props }) {
            return <th style={styles.th} {...props}>{children}</th>
          },
          td({ children, ...props }) {
            return <td style={styles.td} {...props}>{children}</td>
          },
          p({ children }) {
            return <p style={styles.paragraph}>{children}</p>
          },
          ul({ children }) {
            return <ul style={styles.list}>{children}</ul>
          },
          ol({ children }) {
            return <ol style={styles.list}>{children}</ol>
          },
          li({ children }) {
            return <li style={styles.listItem}>{children}</li>
          },
          h1({ children }) {
            return <h1 style={styles.h1}>{children}</h1>
          },
          h2({ children }) {
            return <h2 style={styles.h2}>{children}</h2>
          },
          h3({ children }) {
            return <h3 style={styles.h3}>{children}</h3>
          },
          blockquote({ children }) {
            return <blockquote style={styles.blockquote}>{children}</blockquote>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    fontSize: 14,
    lineHeight: 1.7,
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  },
  paragraph: {
    margin: '6px 0',
  },
  list: {
    margin: '6px 0',
    paddingInlineStart: 20,
  },
  listItem: {
    margin: '3px 0',
  },
  h1: {
    fontSize: 18,
    fontWeight: 700,
    margin: '12px 0 8px',
    color: 'var(--text-primary)',
  },
  h2: {
    fontSize: 16,
    fontWeight: 700,
    margin: '10px 0 6px',
    color: 'var(--text-primary)',
  },
  h3: {
    fontSize: 15,
    fontWeight: 600,
    margin: '8px 0 4px',
    color: 'var(--text-primary)',
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
    fontSize: 13,
  },
  th: {
    border: '1px solid var(--border-light)',
    padding: '6px 10px',
    background: 'var(--bg-input)',
    textAlign: 'left',
    fontWeight: 600,
  },
  td: {
    border: '1px solid var(--border-light)',
    padding: '6px 10px',
  },
  blockquote: {
    margin: '8px 0',
    padding: '4px 12px',
    borderLeft: '3px solid var(--border-light)',
    color: 'var(--text-secondary)',
  },
}

const compactStyles: Record<string, CSSProperties> = {
  wrap: {
    ...styles.wrap,
    fontSize: 13,
    lineHeight: 1.55,
  },
}
