import type { Context, Hono } from 'hono'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname, join, normalize, sep } from 'node:path'
import type { AppConfig } from '../core/config.js'
import { createChildLogger } from '../core/logger.js'
import { readingItemStore } from '../store/reading-items.js'
import { readReadingCookie, readingAuthCookie } from './reading-auth.js'

const log = createChildLogger('gateway:reading-assets')

const READING_MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
}

export function mountReadingAssetRoutes(app: Hono, config: AppConfig): void {
  app.get('/reading/:itemId/*', (context) => handleReadingAsset(context, config))
  app.get('/reading/:itemId', (context) => handleReadingAsset(context, config))
}

function handleReadingAsset(context: Context, config: AppConfig): Response {
  const readingId = context.req.param('itemId')
  if (!readingId) return context.json({ error: 'readingId 缺失' }, 400)
  const item = readingItemStore.get(readingId)
  if (!item) return context.json({ error: '阅读条目不存在' }, 404)
  if (item.format === 'url' || !item.mount_path || !item.entry_file) {
    return context.json({ error: '链接条目没有本地资源' }, 400)
  }

  if (config.localToken) {
    const token = context.req.header('x-ai-ide-token') ?? context.req.query('token')
    const cookieToken = readReadingCookie(context.req.header('cookie'))
    if (token !== config.localToken && cookieToken !== config.localToken) {
      return context.json({ error: '未授权' }, 401)
    }
    if (token === config.localToken) {
      context.header('Set-Cookie', readingAuthCookie(config.localToken, readingId))
    }
  }

  const prefix = `/reading/${readingId}/`
  const rawSubPath = context.req.path.startsWith(prefix) ? context.req.path.slice(prefix.length) : ''
  const subPath = decodeReadingPath(rawSubPath)
  if (subPath == null) return context.json({ error: '阅读资源路径无效' }, 400)
  const relativeFile = subPath || item.entry_file
  const baseDir = normalize(item.mount_path)
  const fullPath = normalize(join(baseDir, relativeFile))
  if (fullPath !== baseDir && !fullPath.startsWith(baseDir + sep)) {
    log.warn({ readingId, relativeFile }, '阻止阅读资源路径越界')
    return context.json({ error: '阅读资源路径越界' }, 400)
  }
  if (!existsSync(fullPath)) return context.json({ error: '阅读资源不存在' }, 404)

  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(fullPath)
  } catch (error) {
    log.error({ err: error, readingId, relativeFile }, '读取阅读资源元数据失败')
    return context.json({ error: '阅读资源不可读' }, 500)
  }
  if (!stat.isFile()) return context.json({ error: '阅读资源路径不是文件' }, 400)

  context.header('Content-Type', READING_MIME_TYPES[extname(fullPath).toLowerCase()] ?? 'application/octet-stream')
  context.header('Content-Length', String(stat.size))
  context.header('Cache-Control', 'no-store')
  const nodeStream = createReadStream(fullPath) as Readable
  return new Response(nodeStreamToWebStream(nodeStream), { status: 200, headers: context.res.headers })
}

function decodeReadingPath(path: string): string | null {
  try {
    return decodeURIComponent(path)
  } catch (error) {
    log.warn({ err: error }, '解码阅读资源路径失败')
    return null
  }
}

function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const cleanup = (): void => {
        nodeStream.off('data', onData)
        nodeStream.off('end', onEnd)
        nodeStream.off('error', onError)
      }
      const onData = (chunk: Buffer): void => controller.enqueue(new Uint8Array(chunk))
      const onEnd = (): void => { cleanup(); controller.close() }
      const onError = (error: Error): void => { cleanup(); controller.error(error) }
      nodeStream.on('data', onData)
      nodeStream.once('end', onEnd)
      nodeStream.once('error', onError)
    },
    cancel() {
      nodeStream.destroy()
    },
  })
}
