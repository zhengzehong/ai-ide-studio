import { useEffect, useState, type CSSProperties } from 'react'
import type { Highlighter } from 'shiki'
import { PlainTextView } from './PlainTextView'

let highlighterPromise: Promise<Highlighter> | null = null
const loadedLangs = new Set<string>()

const CORE_LANGS = ['typescript', 'javascript', 'json', 'python', 'markdown']
const LIGHT_THEME = 'github-light'
const DARK_THEME = 'github-dark'

function detectDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const { createHighlighter } = await import('shiki')
    highlighterPromise = createHighlighter({
      langs: CORE_LANGS,
      themes: [LIGHT_THEME, DARK_THEME],
    })
    CORE_LANGS.forEach((l) => loadedLangs.add(l))
  }
  return highlighterPromise
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<void> {
  if (loadedLangs.has(lang)) return
  try {
    await highlighter.loadLanguage(lang as never)
    loadedLangs.add(lang)
  } catch {
    // unsupported language, fallback to text
  }
}

interface ShikiRendererProps {
  content: string
  language: string
  showLineNumbers: boolean
  embedded: boolean
}

export default function ShikiRenderer({ content, language, showLineNumbers, embedded }: ShikiRendererProps) {
  const [html, setHtml] = useState<string>('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getHighlighter()
      .then(async (hl) => {
        await ensureLanguage(hl, language)
        if (cancelled) return
        const theme = detectDark() ? DARK_THEME : LIGHT_THEME
        try {
          const out = hl.codeToHtml(content, {
            lang: loadedLangs.has(language) ? language : 'text',
            theme,
          })
          if (!cancelled) setHtml(out)
        } catch {
          if (!cancelled) setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [content, language])

  if (failed || !html) {
    return <PlainTextView content={content} />
  }

  return (
    <div
      style={{
        ...styles.wrap,
        ...(embedded ? styles.embedded : styles.fullscreen),
      }}
    >
      <div style={styles.codeBlock} dangerouslySetInnerHTML={{ __html: html }} />
      {showLineNumbers && !embedded && (
        <LineNumberOverlay lineCount={content.split('\n').length} />
      )}
    </div>
  )
}

function LineNumberOverlay({ lineCount }: { lineCount: number }) {
  return (
    <div style={styles.lineNumbers} aria-hidden>
      {Array.from({ length: lineCount }, (_, i) => (
        <div key={i} style={styles.lineNo}>{i + 1}</div>
      ))}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'relative',
  },
  fullscreen: {
    margin: 0,
  },
  embedded: {
    margin: 0,
    borderRadius: 6,
    overflow: 'hidden',
  },
  codeBlock: {
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: 'var(--font-mono, "Fira Code", "Cascadia Code", monospace)',
  },
  lineNumbers: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 40,
    padding: '12px 0',
    textAlign: 'right',
    paddingRight: 12,
    color: 'var(--text-muted)',
    opacity: 0.5,
    userSelect: 'none',
    fontSize: 12,
    pointerEvents: 'none',
  },
  lineNo: {
    height: '1.6em',
  },
}
