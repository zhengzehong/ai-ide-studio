import { createHmac, randomBytes } from 'node:crypto'
import { createChildLogger } from '../core/logger.js'

export interface CaptureConnection {
  agentId: string
  runtime: string
  profileId: string
  providerId: string
  protocol: string
  baseUrl: string
  apiKey: string
  providerName: string
}

/** Internal launch descriptor. Credentials must not be logged or persisted. */
export interface CaptureRouteBinding extends CaptureConnection {
  id: string
  proxyBaseUrl: string
}

interface BindingEntry {
  binding: Readonly<CaptureRouteBinding>
  references: number
}

const log = createChildLogger('model-capture-routes')
const bindings = new Map<string, BindingEntry>()
let listener: { origin: string; salt: Buffer } | undefined
let warnedUnavailable = false

export function activateCaptureRoutes(port: number): () => void {
  const current = { origin: `http://127.0.0.1:${port}`, salt: randomBytes(32) }
  listener = current
  warnedUnavailable = false
  return () => {
    if (listener !== current) return
    listener = undefined
    bindings.clear()
  }
}

/** Pure description: inspection/snapshot creation does not retain a route. */
export function describeCaptureRoute(connection: CaptureConnection): CaptureRouteBinding | undefined {
  if (!listener) {
    if (!warnedUnavailable) {
      log.warn('模型抓包代理未就绪，Runtime 使用原始供应商连接')
      warnedUnavailable = true
    }
    return undefined
  }
  const id = createHmac('sha256', listener.salt).update(JSON.stringify([
    connection.agentId, connection.runtime, connection.profileId, connection.providerId,
    connection.protocol, connection.baseUrl, connection.apiKey, connection.providerName,
  ])).digest('hex')
  return { ...connection, id, proxyBaseUrl: `${listener.origin}/route/${id}` }
}

export function retainCaptureRoute(binding: CaptureRouteBinding): () => void {
  let entry = bindings.get(binding.id)
  if (!entry) {
    entry = { binding: Object.freeze({ ...binding }), references: 0 }
    bindings.set(binding.id, entry)
    log.debug({ agentId: binding.agentId, profileId: binding.profileId, bindingId: binding.id }, '模型代理连接已绑定')
  }
  return retainEntry(entry)
}

export function acquireCaptureRoute(id: string): { binding: Readonly<CaptureRouteBinding>; release: () => void } | undefined {
  const entry = bindings.get(id)
  return entry ? { binding: entry.binding, release: retainEntry(entry) } : undefined
}

function retainEntry(entry: BindingEntry): () => void {
  entry.references += 1
  let released = false
  return () => {
    if (released) return
    released = true
    entry.references -= 1
    if (entry.references === 0 && bindings.get(entry.binding.id) === entry) {
      bindings.delete(entry.binding.id)
      log.debug({ agentId: entry.binding.agentId, bindingId: entry.binding.id }, '模型代理连接已释放')
    }
  }
}
