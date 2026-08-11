import { dialog, type BrowserWindow, type DownloadItem } from 'electron'
import type { DesktopRuntimeTarget } from './desktop-target.js'
import { resolveAndValidateDownloadUrl, sanitizeDownloadFilename } from './desktop-download-policy.js'

export interface DesktopDownloadInput { url: string; filename?: string }
export interface DesktopDownloadResult { ok: boolean; canceled?: boolean; error?: string }

export async function runDesktopDownload(
  window: BrowserWindow,
  target: DesktopRuntimeTarget,
  input: DesktopDownloadInput,
): Promise<DesktopDownloadResult> {
  let url: URL
  try {
    url = resolveAndValidateDownloadUrl(input.url, target.origin)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const filename = sanitizeDownloadFilename(input.filename ?? url.searchParams.get('path')?.split(/[\\/]/).pop())
  const selection = await dialog.showSaveDialog(window, { defaultPath: filename })
  if (selection.canceled || !selection.filePath) return { ok: true, canceled: true }

  return await new Promise<DesktopDownloadResult>((resolve) => {
    const session = window.webContents.session
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const onWillDownload = (_event: Electron.Event, item: DownloadItem): void => {
      if (item.getURL() !== url.toString()) return
      item.setSavePath(selection.filePath as string)
      item.once('done', (_doneEvent, state) => {
        finish(state === 'completed'
          ? { ok: true }
          : { ok: false, error: `下载${state === 'cancelled' ? '已取消' : '失败'}` })
      })
    }
    const finish = (result: DesktopDownloadResult): void => {
      if (settled) return
      settled = true
      session.removeListener('will-download', onWillDownload)
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    timer = setTimeout(() => finish({ ok: false, error: '下载超时' }), 120_000)
    session.on('will-download', onWillDownload)
    window.webContents.downloadURL(url.toString())
  })
}
