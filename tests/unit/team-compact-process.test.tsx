import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TurnContentView } from '../../ui/src/components/chat/TurnContentView.js'
import type { TurnProcessBlock } from '../../ui/src/stores/turn-blocks.js'

const blocks: TurnProcessBlock[] = [
  { id: 'a', kind: 'tool', toolCall: { id: 'a', title: 'Read old-file', status: 'completed' } },
  { id: 'b', kind: 'tool', toolCall: { id: 'b', title: 'Bash npm test', status: 'in_progress' } },
]
function render(compactStreamingProcess?: boolean, isStreaming = true, processBlocks = blocks): string {
  return renderToStaticMarkup(createElement(TurnContentView, {
    processBlocks, finalAnswer: isStreaming ? '' : '完成回复', isStreaming, compactStreamingProcess,
    renderProcessBlock: block => createElement('div', { key: block.id, 'data-detail': block.id }, block.id),
  }))
}
describe('team compact streaming process', () => {
  it('keeps ordinary streaming history expanded by default', () => {
    expect(render()).toContain('data-detail="a"')
    expect(render()).toContain('data-detail="b"')
  })
  it('collapses team history and exposes only the latest summary without raw details', () => {
    const html = render(true)
    expect(html).not.toContain('data-detail=')
    expect(html).not.toContain('Read old-file')
    expect(html).toContain('Bash npm test')
    expect(html).toContain('执行中')
  })
  it('updates the last tool status and preserves final output after done', () => {
    const completed: TurnProcessBlock[] = [{ id: 'b', kind: 'tool', toolCall: { id: 'b', title: 'Bash npm test', status: 'completed' } }]
    expect(render(true, true, completed)).toContain('已完成')
    expect(render(true, false)).toContain('完成回复')
    expect(render(true, false)).not.toContain('data-latest-process')
  })
})
