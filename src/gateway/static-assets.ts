import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import type { AppConfig } from '../core/config.js'

export function mountStaticAssets(app: Hono, config: AppConfig): void {
  if (config.mobileStaticDir && existsSync(join(config.mobileStaticDir, 'index.html'))) {
    const mobileRoot = relative(process.cwd(), config.mobileStaticDir) || '.'
    app.use('/app/*', serveStatic({ root: mobileRoot, rewriteRequestPath: (p) => p.replace(/^\/app/, '') }))
    app.get('/app/*', serveStatic({ root: mobileRoot, path: 'index.html' }))
  }

  if (!config.staticDir || !existsSync(join(config.staticDir, 'index.html'))) return

  app.use('*', serveStatic({ root: config.staticDir }))
  app.get('*', serveStatic({ root: config.staticDir, path: 'index.html' }))
}

export function staticDirForLog(config: AppConfig): string | undefined {
  return config.staticDir ? relative(process.cwd(), config.staticDir) || '.' : undefined
}
