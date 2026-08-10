import { requestFileAssetUrl, type FileAssetUrlRequest } from '@desktop/services/file-assets'
import { useConnectionStore } from '../stores/connection.store'

export async function requestMobileFileAssetUrl(input: FileAssetUrlRequest): Promise<string> {
  const result = await requestFileAssetUrl(input)
  if (/^https?:\/\//i.test(result.url)) return result.url
  const configured = useConnectionStore.getState().serverUrl.trim()
  const base = configured || (typeof window !== 'undefined' ? window.location.origin : '')
  if (!base) throw new Error('服务器地址未配置')
  return new URL(result.url, `${base.replace(/\/$/, '')}/`).toString()
}
