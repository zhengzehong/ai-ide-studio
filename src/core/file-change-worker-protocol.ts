import type { FileChangeDetailData, ToolCallData } from '../types/ws-protocol.js'

export interface FileChangeWorkerRequest {
  type: 'calculate'
  requestId: string
  toolCall: ToolCallData
}

export interface FileChangeWorkerResult {
  type: 'result'
  requestId: string
  changes: FileChangeDetailData
  executionMs: number
}

export interface FileChangeWorkerFailure {
  type: 'error'
  requestId: string
  error: string
}

export interface FileChangeWorkerReady {
  type: 'ready'
}

export type FileChangeWorkerResponse = FileChangeWorkerResult | FileChangeWorkerFailure | FileChangeWorkerReady

export function isFileChangeWorkerRequest(value: unknown): value is FileChangeWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<FileChangeWorkerRequest>
  return request.type === 'calculate'
    && typeof request.requestId === 'string'
    && !!request.toolCall
    && typeof request.toolCall === 'object'
}

export function isFileChangeWorkerResponse(value: unknown): value is FileChangeWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<FileChangeWorkerResponse>
  if (response.type === 'ready') return true
  return (response.type === 'result' || response.type === 'error') && typeof response.requestId === 'string'
}
