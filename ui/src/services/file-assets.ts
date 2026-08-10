import { wsClient } from './ws-client'

export interface FileAssetUrlResult {
  url: string
  expiresAt: number
  path: string
  kind: 'text' | 'image' | 'audio' | 'video' | 'binary'
}

export interface FileAssetUrlRequest {
  projectId: string
  filePath: string
  basePath?: string
  mode?: 'inline' | 'attachment'
}

export function isExternalAssetUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function isUnsafeAssetUrl(value: string): boolean {
  return /^(?:javascript|vbscript|data:text\/html):/i.test(value.trim())
}

export async function requestFileAssetUrl(input: FileAssetUrlRequest): Promise<FileAssetUrlResult> {
  const filePath = input.filePath.trim()
  if (!filePath || isUnsafeAssetUrl(filePath)) throw new Error('资源地址无效')
  if (isExternalAssetUrl(filePath)) {
    return { url: filePath, expiresAt: Number.MAX_SAFE_INTEGER, path: filePath, kind: 'binary' }
  }
  return await wsClient.request({
    type: 'fs.assetUrl',
    projectId: input.projectId,
    filePath,
    basePath: input.basePath,
    mode: input.mode ?? 'inline',
  }) as FileAssetUrlResult
}
