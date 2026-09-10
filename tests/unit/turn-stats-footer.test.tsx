import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TurnStatsFooter } from '../../ui/src/components/chat/TurnStatsFooter'
import { parseTurnStats } from '../../ui/src/components/chat/turn-stats'

describe('shared reply statistics', () => {
  it('renders partial usage without inventing missing token counts', () => {
    const markup = renderToStaticMarkup(createElement(TurnStatsFooter, { stats: { outputTokens: 3, elapsedSeconds: 5, costAmount: 0 } }))
    expect(markup).toContain('5s')
    expect(markup).toContain('输出')
    expect(markup).not.toContain('输入')
    expect(markup).toContain('$0.0000')
  })

  it('keeps elapsed time for incomplete or invalid historical usage', () => {
    const stats = parseTurnStats('{invalid', '2026-09-11T00:00:00Z', '2026-09-11T00:00:09Z')
    expect(stats).toEqual({ elapsedSeconds: 9 })
    expect(renderToStaticMarkup(createElement(TurnStatsFooter, { stats }))).toContain('9s')
  })

  it('tolerates invalid and absent start dates without displaying a false timer', () => {
    expect(renderToStaticMarkup(createElement(TurnStatsFooter, { streaming: true, startedAt: 'bad' }))).toBe('')
    expect(renderToStaticMarkup(createElement(TurnStatsFooter, {}))).toBe('')
  })

  it('uses recorded usage duration instead of the current wall clock after completion', () => {
    const stats = parseTurnStats('{"inputTokens":0,"outputTokens":2,"elapsedSeconds":4}', '2026-09-11T00:00:00Z', '2026-09-11T00:00:08Z')
    const markup = renderToStaticMarkup(createElement(TurnStatsFooter, { stats }))
    expect(markup).toContain('4s')
    expect(markup).toContain('输入')
    expect(markup).not.toContain('8s')
    expect(markup).not.toContain('spin 1s')
  })
})
