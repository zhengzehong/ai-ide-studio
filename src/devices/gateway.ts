import { join } from 'node:path'
import type { Hono } from 'hono'
import type { AppConfig } from '../core/config.js'
import { DeviceConnections } from './connections.js'
import { DeviceJobService } from './job-service.js'
import { DeviceToolService } from './tool-service.js'
import { DeviceTransferService } from './transfer-service.js'
import { mountDeviceRoutes } from './http-routes.js'
import { registerDeviceToolExecutor } from './tool-provider.js'

export function createDeviceGateway(app: Hono, config: AppConfig): { connections: DeviceConnections; close(): void } {
  const connections = new DeviceConnections({
    connected: (id) => jobs.connected(id), disconnected: (id) => jobs.disconnected(id),
    message: (id, frame) => jobs.message(id, frame),
  })
  const jobs = new DeviceJobService(connections, join(config.dataDir, 'device-job-logs'))
  const transfers = new DeviceTransferService(jobs, join(config.dataDir, 'device-files'))
  const service = new DeviceToolService(connections, jobs, (input, context) => transfers.submit(input, context))
  mountDeviceRoutes(app, config, connections, service)
  transfers.mount(app)
  const unregister = registerDeviceToolExecutor((action, input, context) => service.execute(action, input, context))
  let closed = false
  return { connections, close(): void {
    if (closed) return
    closed = true
    unregister(); transfers.close(); jobs.close(); connections.close()
  } }
}
