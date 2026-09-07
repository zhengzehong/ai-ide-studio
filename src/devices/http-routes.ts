import type { Hono, Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { AppConfig } from '../core/config.js'
import { createChildLogger } from '../core/logger.js'
import { deviceStore } from '../store/devices.js'
import { validateToolToken } from '../tools/registry/context-registry.js'
import { resolveVisiblePlatformTools } from '../tools/registry/visibility-resolver.js'
import { issueDevicePairing, pairDevice } from './auth.js'
import type { DeviceConnections } from './connections.js'
import type { DeviceToolService } from './tool-service.js'

const log = createChildLogger('devices:http')

export function mountDeviceRoutes(app: Hono, config: AppConfig, connections: DeviceConnections, service: DeviceToolService): void {
  app.post('/node/pair', async (c) => {
    try {
      const result = pairDevice(await readSmallJson(c), getConnInfo(c).remote.address ?? 'unknown')
      return c.json(result)
    } catch (err) { log.warn({ err }, '设备配对失败'); return c.json({ error: errorText(err) }, 400) }
  })
  app.get('/api/v1/devices', (c) => {
    if (!owner(c, config)) return c.json({ error: '仅所有者可管理设备' }, 403)
    return c.json(service.list())
  })
  app.post('/api/v1/devices/pairing', (c) => {
    if (!owner(c, config)) return c.json({ error: '仅所有者可配对设备' }, 403)
    return c.json(issueDevicePairing())
  })
  app.post('/api/v1/devices/:id', async (c) => {
    if (!owner(c, config)) return c.json({ error: '仅所有者可管理设备' }, 403)
    try {
      const input = await readSmallJson(c)
      const id = c.req.param('id')
      const device = deviceStore.get(id)
      if (device?.revoked_at && input.action === 'revoke') return c.json({ ok: true })
      if (!device || device.revoked_at) return c.json({ error: '设备不存在或已解除配对' }, 404)
      if (input.action === 'revoke') deviceStore.revoke(id)
      else if (typeof input.enabled === 'boolean') deviceStore.setEnabled(id, input.enabled)
      else throw new Error('设备操作无效')
      if (input.action === 'revoke' || input.enabled === false) connections.disconnect(id)
      log.info({ deviceId: id, action: input.action, enabled: input.enabled }, '设备授权已调整')
      return c.json({ ok: true })
    } catch (err) { log.warn({ err }, '设备管理失败'); return c.json({ error: errorText(err) }, 400) }
  })
  app.post('/device-tools', async (c) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1]
    const context = token ? validateToolToken(token) : null
    if (!context) return c.json({ error: '工具未授权' }, 401)
    try {
      const body = await readSmallJson(c, 128 * 1024)
      const action = body.action
      if (action !== 'device_list' && action !== 'invoke_device_command') throw new Error('工具名称无效')
      if (!context.visibleTools.includes(action) || !resolveVisiblePlatformTools(context).some((tool) => tool.definition.name === action)) {
        return c.json({ error: '工具不可见或已停用' }, 403)
      }
      if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) throw new Error('工具参数无效')
      return c.json(await service.execute(action, body.input as Record<string, unknown>, context))
    } catch (err) {
      log.warn({ err, sessionId: context.sessionId }, '设备工具执行失败')
      return c.json({ error: errorText(err) }, 400)
    }
  })
}

function owner(c: Context, config: AppConfig): boolean {
  return !config.localToken || c.req.header('x-ai-ide-token') === config.localToken
}

async function readSmallJson(c: Context, limit = 8192): Promise<Record<string, unknown>> {
  if (Number(c.req.header('content-length')) > limit) throw new Error('请求过大')
  const reader = c.req.raw.body?.getReader()
  if (!reader) throw new Error('请求体缺失')
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) { await reader.cancel(); throw new Error('请求过大') }
    chunks.push(value)
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求格式无效')
  return body as Record<string, unknown>
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : '设备操作失败' }
