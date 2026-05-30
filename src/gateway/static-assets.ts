import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import type { AppConfig } from '../core/config.js'

export function mountStaticAssets(app: Hono, config: AppConfig): void {
  if (!config.staticDir || !existsSync(join(config.staticDir, 'index.html'))) return

  app.use('*', serveStatic({ root: config.staticDir }))
  app.get('*', serveStatic({ root: config.staticDir, path: 'index.html' }))
}

export function staticDirForLog(config: AppConfig): string | undefined {
  return config.staticDir ? relative(process.cwd(), config.staticDir) || '.' : undefined
}
