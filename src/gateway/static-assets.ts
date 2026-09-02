import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import type { AppConfig } from '../core/config.js'

const IMMUTABLE_ASSET_PATTERN = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico)$/i

export function cacheControlForAssetPath(path: string): string {
  return IMMUTABLE_ASSET_PATTERN.test(path)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
}

export function shouldUseSpaFallback(path: string): boolean {
  const pathname = path.split('?', 1)[0] ?? path
  if (pathname.startsWith('/assets/') || pathname.startsWith('/app/assets/')) return false
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  return !lastSegment.includes('.')
}

export function mountStaticAssets(app: Hono, config: AppConfig): void {
  if (config.mobileStaticDir && existsSync(join(config.mobileStaticDir, 'index.html'))) {
    const mobileRoot = relative(process.cwd(), config.mobileStaticDir) || '.'
    app.use('/app/*', serveStatic({
      root: mobileRoot,
      rewriteRequestPath: (p) => p.replace(/^\/app/, ''),
      onFound: (_path, c) => c.header('Cache-Control', cacheControlForAssetPath(c.req.path)),
    }))
    const mobileFallback = serveStatic({
      root: mobileRoot,
      path: 'index.html',
      onFound: (_path, c) => c.header('Cache-Control', 'no-cache'),
    })
    app.get('/app/*', (c, next) => shouldUseSpaFallback(c.req.path) ? mobileFallback(c, next) : next())
  }

  if (!config.staticDir || !existsSync(join(config.staticDir, 'index.html'))) return

  app.use('*', serveStatic({
    root: config.staticDir,
    onFound: (_path, c) => c.header('Cache-Control', cacheControlForAssetPath(c.req.path)),
  }))
  const desktopFallback = serveStatic({
    root: config.staticDir,
    path: 'index.html',
    onFound: (_path, c) => c.header('Cache-Control', 'no-cache'),
  })
  app.get('*', (c, next) => shouldUseSpaFallback(c.req.path) ? desktopFallback(c, next) : next())
}

export function staticDirForLog(config: AppConfig): string | undefined {
  return config.staticDir ? relative(process.cwd(), config.staticDir) || '.' : undefined
}
