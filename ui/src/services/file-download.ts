import { getElectronDesktopBridge } from './electron-desktop'
import { requestFileAssetUrl } from './file-assets'

export interface FileDownloadRequest {
  projectId: string
  filePath: string
  filename?: string
  basePath?: string
}

export async function downloadFile(input: FileDownloadRequest): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const asset = await requestFileAssetUrl({
    projectId: input.projectId,
    filePath: input.filePath,
    basePath: input.basePath,
    mode: 'attachment',
  })
  const bridge = getElectronDesktopBridge()
  if (bridge?.downloadFile) return await bridge.downloadFile({ url: asset.url, filename: input.filename })
  const anchor = document.createElement('a')
  anchor.href = asset.url
  anchor.download = input.filename ?? input.filePath.split(/[\\/]/).pop() ?? 'download'
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return { ok: true }
}
