import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const css = readFileSync('ui/src/pages/widget/widget.css', 'utf8')

describe('Widget Session activity compact layout', () => {
  test('keeps status, content, and time visible in the 300px Widget', () => {
    expect(css).toContain('margin: 2px 0 0 4px;')
    expect(css).toContain('grid-template-columns: 42px minmax(0, 1fr) 30px;')
    expect(css).toContain('text-align: right;')
    expect(css).not.toContain('.widget-session-time { display: none; }')
  })
})
