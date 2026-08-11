export function resolveAndValidateDownloadUrl(url: string, targetOrigin: string): URL {
  const parsed = new URL(url, `${targetOrigin.replace(/\/$/, '')}/`)
  const target = new URL(targetOrigin)
  if (parsed.origin !== target.origin || parsed.pathname !== '/api/fs/asset') throw new Error('下载地址不受信任')
  if (parsed.searchParams.get('mode') !== 'attachment'
    || !parsed.searchParams.get('projectId')
    || !parsed.searchParams.get('path')
    || !parsed.searchParams.get('expires')
    || !parsed.searchParams.get('signature')) throw new Error('下载地址缺少有效签名')
  return parsed
}

export function sanitizeDownloadFilename(value: string | undefined): string {
  const fallback = 'download'
  const name = (value ?? fallback).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  return name.replace(/^\.+$/, '').slice(0, 240) || fallback
}
