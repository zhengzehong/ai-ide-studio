import type { Hono } from 'hono'
import type { DataRetentionService } from '../../data-retention/retention-service.js'
import { createChildLogger } from '../../core/logger.js'

const log = createChildLogger('gateway:retention')

export function mountRetentionRoutes(app: Hono, retention: DataRetentionService, controlToken: string): void {
  app.use('/api/v1/retention/*', async (c, next) => {
    if (c.req.header('x-ai-ide-retention-token') !== controlToken) {
      log.warn('retention control request rejected')
      return c.json({ error: '未授权的清理控制请求' }, 403)
    }
    await next()
  })

  app.get('/api/v1/retention/status', (c) => c.json(retention.status()))
  app.post('/api/v1/retention/dry-run', async (c) => {
    try {
      const result = await retention.dryRun()
      return c.json({ status: retention.status(), result })
    } catch (err) {
      return c.json({ error: errorMessage(err), status: retention.status() }, 409)
    }
  })
  app.post('/api/v1/retention/delete', async (c) => {
    const body: { confirm?: boolean } = await c.req.json<{ confirm?: boolean }>().catch(() => ({}))
    if (body.confirm !== true) return c.json({ error: '必须显式传入 confirm=true' }, 400)
    try {
      return c.json(retention.startDelete(), 202)
    } catch (err) {
      return c.json({ error: errorMessage(err), status: retention.status() }, 409)
    }
  })
  app.post('/api/v1/retention/stop', (c) => c.json(retention.stop()))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
