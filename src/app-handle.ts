import type { Server } from 'http'
import type { Hono } from 'hono'
import type { WebSocketServer } from 'ws'
import type { DataWorkerMode, RealtimeMode, RuntimeMode } from './core/config.js'

export interface AppHandle {
  app: Hono
  server: Server
  wss?: WebSocketServer
  dataWorkerMode: DataWorkerMode
  realtimeMode: RealtimeMode
  runtimeMode: RuntimeMode
  readonly httpEndpoint: string
  readonly realtimeEndpoint: string
  onRealtimeEndpointChange(listener: (endpointUrl: string) => void): () => void
  restartRealtimeForTest(): Promise<void>
  stop: () => Promise<void>
}
