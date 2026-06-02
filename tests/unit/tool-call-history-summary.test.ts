import { describe, expect, test } from 'vitest'
import { selectToolCallDetail, summarizeToolCalls } from '../../src/store/tool-call-history.js'
import type { ToolCallData } from '../../src/types/ws-protocol.js'

describe('tool call history summaries', () => {
  test('summary omits full raw output and keeps lightweight metadata', () => {
    const tools: ToolCallData[] = [
      { id: 'tool-1', title: 'Read file', kind: 'read', status: 'completed', rawOutput: 'x'.repeat(1000) },
    ]

    const summary = summarizeToolCalls(tools)

    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({ id: 'tool-1', title: 'Read file', kind: 'read', status: 'completed', hasRawOutput: true })
    expect(summary[0].outputPreview?.length).toBeLessThanOrEqual(160)
    expect(JSON.stringify(summary)).not.toContain('x'.repeat(500))
  })

  test('detail returns only selected tool and truncates large output', () => {
    const tools: ToolCallData[] = [
      { id: 'tool-1', title: 'Small', rawOutput: 'small' },
      { id: 'tool-2', title: 'Large', rawOutput: 'y'.repeat(25_000), terminalOutput: 'z'.repeat(25_000) },
    ]

    const detail = selectToolCallDetail(tools, 'tool-2')

    expect(detail?.id).toBe('tool-2')
    expect(detail?.rawOutputPreview?.length).toBe(20_000)
    expect(detail?.rawOutputTruncated).toBe(true)
    expect(detail?.terminalOutputTail?.length).toBe(20_000)
    expect(detail?.terminalOutputTruncated).toBe(true)
    expect(JSON.stringify(detail)).not.toContain('small')
  })
})
