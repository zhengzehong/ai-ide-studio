import type { WorkerErrorCode } from '../protocol.js'

export class WriterOperationError extends Error {
  readonly code: WorkerErrorCode

  constructor(code: WorkerErrorCode, message: string) {
    super(message)
    this.name = 'WriterOperationError'
    this.code = code
  }
}
