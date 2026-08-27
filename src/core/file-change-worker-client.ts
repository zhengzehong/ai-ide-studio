import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { resolveWorkerEntryUrl } from '../data-worker/worker-entry-url.js'
import { createChildLogger } from './logger.js'
import type { FileChangeDetailData, ToolCallData } from '../types/ws-protocol.js'
import {
  isFileChangeWorkerResponse,
  type FileChangeWorkerResult,
} from './file-change-worker-protocol.js'

interface PendingCalculation {
  resolve: (result: FileChangeWorkerResult) => void
  reject: (error: Error) => void
}

const log = createChildLogger('file-change-worker-client')
let sharedWorker: Promise<FileChangeWorkerClient> | undefined

export interface FileChangeWorkerClient {
  calculate(toolCall: ToolCallData): Promise<FileChangeWorkerResult>
  close(): Promise<void>
}

export async function createFileChangeWorker(): Promise<FileChangeWorkerClient> {
  const entryUrl = resolveWorkerEntryUrl('./file-change-worker-entry', import.meta.url)
  const worker = new Worker(entryUrl, {
    execArgv: entryUrl.pathname.endsWith('.ts') ? ['--import', 'tsx'] : undefined,
  })
  await waitUntilReady(worker)
  worker.unref()
  const pending = new Map<string, PendingCalculation>()
  let closed = false

  const failAll = (error: Error): void => {
    for (const calculation of pending.values()) calculation.reject(error)
    pending.clear()
  }
  const onMessage = (message: unknown): void => {
    if (!isFileChangeWorkerResponse(message) || message.type === 'ready') return
    const calculation = pending.get(message.requestId)
    if (!calculation) return
    pending.delete(message.requestId)
    if (message.type === 'error') calculation.reject(new Error(message.error))
    else calculation.resolve(message)
  }
  const onError = (error: Error): void => failAll(error)
  const onExit = (code: number): void => {
    if (!closed) failAll(new Error(`File-change Worker exited with code ${code}`))
  }
  worker.on('message', onMessage)
  worker.on('error', onError)
  worker.on('exit', onExit)

  return {
    calculate(toolCall: ToolCallData): Promise<FileChangeWorkerResult> {
      if (closed) return Promise.reject(new Error('File-change Worker is closed'))
      const requestId = randomUUID()
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        try {
          worker.postMessage({ type: 'calculate', requestId, toolCall })
        } catch (error) {
          pending.delete(requestId)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      failAll(new Error('File-change Worker closed'))
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
      await worker.terminate()
    },
  }
}

export async function calculateFileChangesInWorker(toolCall: ToolCallData): Promise<FileChangeDetailData> {
  const client = await getSharedWorker()
  try {
    const result = await client.calculate(toolCall)
    const context = {
      toolCallId: toolCall.id,
      fileCount: result.changes.files.length,
      executionMs: Number(result.executionMs.toFixed(2)),
    }
    if (result.executionMs >= 100) log.warn(context, 'slow file-change worker calculation completed')
    else log.debug(context, 'file-change worker calculation completed')
    return result.changes
  } catch (error) {
    if (sharedWorker) {
      const failed = sharedWorker
      sharedWorker = undefined
      void failed.then((worker) => worker.close()).catch(() => undefined)
    }
    throw error
  }
}

export async function calculateFileChangesForToolsInWorker(
  toolCalls: ToolCallData[],
): Promise<FileChangeDetailData> {
  const details = await Promise.all(
    toolCalls
      .filter((toolCall) => toolCall.content?.some((item) => item.type === 'diff'))
      .map((toolCall) => calculateFileChangesInWorker(toolCall)),
  )
  const files = new Map<string, FileChangeDetailData['files'][number]>()
  for (const detail of details) {
    for (const file of detail.files) {
      const existing = files.get(file.path)
      if (existing) {
        existing.addedLines += file.addedLines
        existing.deletedLines += file.deletedLines
        existing.changeType = mergeChangeType(existing.changeType, file.changeType)
        existing.segments.push(...file.segments)
      } else {
        files.set(file.path, { ...file, segments: [...file.segments] })
      }
    }
  }
  const merged = [...files.values()]
  return {
    files: merged,
    totalAdded: merged.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeleted: merged.reduce((sum, file) => sum + file.deletedLines, 0),
  }
}

export async function closeSharedFileChangeWorker(): Promise<void> {
  const current = sharedWorker
  sharedWorker = undefined
  if (!current) return
  await (await current).close()
}

function getSharedWorker(): Promise<FileChangeWorkerClient> {
  sharedWorker ??= createFileChangeWorker()
  return sharedWorker
}

function mergeChangeType(
  current: FileChangeDetailData['files'][number]['changeType'],
  next: FileChangeDetailData['files'][number]['changeType'],
): FileChangeDetailData['files'][number]['changeType'] {
  if (current === next) return current
  if (current === 'A' && next === 'M') return 'A'
  if (current === '?' || next === '?') return '?'
  return 'M'
}

function waitUntilReady(worker: Worker, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`File-change Worker readiness timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMessage = (message: unknown): void => {
      if (!isFileChangeWorkerResponse(message) || message.type !== 'ready') return
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number): void => {
      cleanup()
      reject(new Error(`File-change Worker exited before ready with code ${code}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
  })
}
