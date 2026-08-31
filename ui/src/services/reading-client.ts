import { buildProjectPath } from '../routing/project-routes'
import { wsClient } from './ws-client'
import type { ReadingItem, ReadingListFilter, ReadingListResult, ReadingStatus } from '../types/reading'

export async function listReadingItems(filter: ReadingListFilter = {}): Promise<ReadingListResult> {
  return await wsClient.request({ type: 'reading.list', ...filter }) as ReadingListResult
}

export async function getReadingItem(readingId: string): Promise<ReadingItem> {
  const payload = await wsClient.request({ type: 'reading.get', readingId }) as { item: ReadingItem }
  return payload.item
}

export async function updateReadingStatus(
  readingId: string,
  status: Extract<ReadingStatus, 'read' | 'archived'>,
): Promise<ReadingItem> {
  const payload = await wsClient.request({ type: 'reading.update', readingId, status }) as { item: ReadingItem }
  return payload.item
}

export function absoluteReadingUrl(url: string, serverUrl?: string): string {
  if (/^https?:\/\//i.test(url) || !serverUrl) return url
  return `${serverUrl.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

export function resolveReadingAssetUrl(source: string, baseUrl: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(source)) return source
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  return new URL(source, new URL(baseUrl, origin)).toString()
}

export function readingWorkspacePath(projectId: string, sessionId: string): string {
  return buildProjectPath(projectId, {
    pathname: '/workspace',
    search: `?sessionId=${encodeURIComponent(sessionId)}`,
    hash: '',
  })
}
