import type { CSSProperties } from 'react'

export function PlainTextView({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <pre style={styles.pre}>
      {lines.map((line, i) => (
        <div key={i} style={styles.line}>
          <span style={styles.lineNo}>{i + 1}</span>
          <span style={styles.lineContent}>{line || ' '}</span>
        </div>
      ))}
    </pre>
  )
}

const styles: Record<string, CSSProperties> = {
  pre: {
    margin: 0,
    padding: 12,
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: 'var(--font-mono, "Fira Code", "Cascadia Code", monospace)',
    color: 'var(--text-primary)',
    whiteSpace: 'pre',
    overflowX: 'auto',
  },
  line: {
    display: 'flex',
  },
  lineNo: {
    display: 'inline-block',
    width: 40,
    textAlign: 'right',
    paddingRight: 12,
    color: 'var(--text-muted)',
    opacity: 0.5,
    userSelect: 'none',
    flexShrink: 0,
    fontSize: 12,
  },
  lineContent: {
    flex: 1,
  },
}
