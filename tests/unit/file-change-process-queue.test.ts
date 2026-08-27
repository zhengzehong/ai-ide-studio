import { describe, expect, test, vi } from 'vitest'
import { FileChangeProcessQueue } from '../../src/core/file-change-process-queue.js'
import type { FileChangeDetailData, ToolCallData } from '../../src/types/ws-protocol.js'

describe('FileChangeProcessQueue', () => {
  test('coalesces running updates and computes the latest terminal diff once', async () => {
    const calculate = vi.fn(async (toolCall: ToolCallData) => detailFor(toolCall))
    const committed: FileChangeDetailData[] = []
    const queue = new FileChangeProcessQueue({ calculate })

    queue.update(input(tool('running', 'first'), (detail) => committed.push(detail)))
    queue.update(input(tool('running', 'second'), (detail) => committed.push(detail)))
    expect(calculate).not.toHaveBeenCalled()

    queue.update(input(tool('completed', 'final'), (detail) => committed.push(detail)))
    await queue.drain('session-1')

    expect(calculate).toHaveBeenCalledOnce()
    expect(calculate.mock.calls[0]?.[0].content?.[0]).toMatchObject({ newText: 'final' })
    expect(committed).toHaveLength(1)
  })

  test('computes the latest non-terminal diff during terminal drain', async () => {
    const calculate = vi.fn(async (toolCall: ToolCallData) => detailFor(toolCall))
    const onResult = vi.fn()
    const queue = new FileChangeProcessQueue({ calculate })

    queue.update(input(tool('running', 'latest'), onResult))
    await queue.drain('session-1')

    expect(calculate).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledOnce()
  })

  test('does not recompute the same terminal tool during final drain', async () => {
    const calculate = vi.fn(async (toolCall: ToolCallData) => detailFor(toolCall))
    const queue = new FileChangeProcessQueue({ calculate })
    const terminal = tool('completed', 'final')
    const processInput = input(terminal, vi.fn())

    queue.update(processInput)
    queue.update(input({ ...terminal, progress: ['done'] }, vi.fn()))
    await queue.drain('session-1')

    expect(calculate).toHaveBeenCalledOnce()
  })

  test('contains worker failures and lets terminal drain finish', async () => {
    const error = new Error('worker failed')
    const onError = vi.fn()
    const queue = new FileChangeProcessQueue({
      calculate: async () => { throw error },
      onError,
    })

    queue.update(input(tool('completed', 'final'), vi.fn()))

    await expect(queue.drain('session-1')).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(error, expect.objectContaining({ sessionId: 'session-1' }))
  })

  test('drops an in-flight worker result after the queue is reset', async () => {
    let resolveCalculation: ((detail: FileChangeDetailData) => void) | undefined
    const calculate = vi.fn(() => new Promise<FileChangeDetailData>((resolve) => {
      resolveCalculation = resolve
    }))
    const onResult = vi.fn()
    const queue = new FileChangeProcessQueue({ calculate })

    queue.update(input(tool('completed', 'late'), onResult))
    queue.reset()
    resolveCalculation?.(detailFor(tool('completed', 'late')))
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate))

    expect(onResult).not.toHaveBeenCalled()
  })
})

function input(toolCall: ToolCallData, onResult: (detail: FileChangeDetailData, toolCall: ToolCallData) => void) {
  return {
    sessionId: 'session-1',
    messageId: 'message-1',
    agentId: 'agent-1',
    toolCall,
    onResult,
  }
}

function tool(status: string, newText: string): ToolCallData {
  return {
    id: 'tool-1',
    title: 'Edit file',
    status,
    content: [{ type: 'diff', path: 'src/app.ts', oldText: 'old', newText }],
  }
}

function detailFor(toolCall: ToolCallData): FileChangeDetailData {
  const content = toolCall.content?.[0]
  return {
    files: [{
      path: content?.path ?? 'unknown',
      changeType: 'M',
      addedLines: 1,
      deletedLines: 1,
      segments: [],
    }],
    totalAdded: 1,
    totalDeleted: 1,
  }
}
