import { getStoredAccessToken } from '../stores/connection.store'

interface AuthenticatedImageLoaderOptions {
  fetchImpl?: typeof fetch
  getAccessToken?: () => string
  createObjectUrl?: (blob: Blob) => string
  revokeObjectUrl?: (url: string) => void
  maxEntries?: number
}

interface CachedImage {
  promise: Promise<string>
  objectUrl?: string
}

export interface AuthenticatedImageLoader {
  load(url: string): Promise<string>
  dispose(): void
}

export function createAuthenticatedImageLoader(
  options: AuthenticatedImageLoaderOptions = {},
): AuthenticatedImageLoader {
  const fetchImpl = options.fetchImpl ?? fetch
  const getAccessToken = options.getAccessToken ?? getStoredAccessToken
  const createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob))
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url))
  const maxEntries = options.maxEntries ?? 64
  const cache = new Map<string, CachedImage>()

  return {
    load(url): Promise<string> {
      if (!isProtectedImageUrl(url)) return Promise.reject(new Error('图片地址无效'))
      const cached = cache.get(url)
      if (cached) {
        cache.delete(url)
        cache.set(url, cached)
        return cached.promise
      }

      const entry: CachedImage = { promise: Promise.resolve('') }
      entry.promise = fetchImage(fetchImpl, getAccessToken, url)
        .then((blob) => {
          entry.objectUrl = createObjectUrl(blob)
          trimCache(cache, maxEntries, revokeObjectUrl)
          return entry.objectUrl
        })
        .catch((error: unknown) => {
          if (cache.get(url) === entry) cache.delete(url)
          throw error
        })
      cache.set(url, entry)
      return entry.promise
    },

    dispose(): void {
      for (const entry of cache.values()) {
        if (entry.objectUrl) revokeObjectUrl(entry.objectUrl)
      }
      cache.clear()
    },
  }
}

async function fetchImage(
  fetchImpl: typeof fetch,
  getAccessToken: () => string,
  url: string,
): Promise<Blob> {
  const token = getAccessToken().trim()
  const headers: Record<string, string> = {}
  if (token) headers['x-ai-ide-token'] = token
  const response = await fetchImpl(url, { headers })
  if (!response.ok) throw new Error(`图片加载失败（HTTP ${response.status}）`)
  const contentType = response.headers.get('Content-Type')
  if (contentType && !contentType.toLowerCase().startsWith('image/')) throw new Error('图片响应格式无效')
  return response.blob()
}

function isProtectedImageUrl(url: string): boolean {
  return url.startsWith('/api/images/') && !url.startsWith('//')
}

function trimCache(
  cache: Map<string, CachedImage>,
  maxEntries: number,
  revokeObjectUrl: (url: string) => void,
): void {
  if (cache.size <= maxEntries) return
  for (const [url, entry] of cache) {
    if (cache.size <= maxEntries) break
    if (!entry.objectUrl) continue
    cache.delete(url)
    revokeObjectUrl(entry.objectUrl)
  }
}

export const authenticatedImageLoader = createAuthenticatedImageLoader()
