import { lazy, Suspense } from 'react'
import { PlainTextView } from './PlainTextView'

const ShikiRenderer = lazy(() => import('./ShikiRenderer'))

interface CodeViewProps {
  content: string
  language: string
  embedded?: boolean
}

export function CodeView({ content, language, embedded = false }: CodeViewProps) {
  const lineCount = content.split('\n').length
  const sizeKB = content.length / 1024
  const showLineNumbers = lineCount <= 500 && sizeKB <= 100

  return (
    <Suspense fallback={<PlainTextView content={content} />}>
      <ShikiRenderer
        content={content}
        language={language}
        showLineNumbers={showLineNumbers}
        embedded={embedded}
      />
    </Suspense>
  )
}
