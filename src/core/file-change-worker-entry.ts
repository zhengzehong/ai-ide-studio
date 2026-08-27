import { parentPort } from 'node:worker_threads'
import { buildFileChangesFromToolCalls } from '../store/file-changes.js'
import { isFileChangeWorkerRequest, type FileChangeWorkerResponse } from './file-change-worker-protocol.js'

if (!parentPort) throw new Error('File-change Worker requires a parent MessagePort')

const port = parentPort
port.postMessage({ type: 'ready' } satisfies FileChangeWorkerResponse)
port.on('message', (message: unknown) => {
  if (!isFileChangeWorkerRequest(message)) return
  const startedAt = performance.now()
  try {
    port.postMessage({
      type: 'result',
      requestId: message.requestId,
      changes: buildFileChangesFromToolCalls([message.toolCall]),
      executionMs: performance.now() - startedAt,
    } satisfies FileChangeWorkerResponse)
  } catch (error) {
    port.postMessage({
      type: 'error',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies FileChangeWorkerResponse)
  }
})
