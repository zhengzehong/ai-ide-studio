import { existsSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { FramedSocket } from '../ipc/framed-socket.js'
import type { IpcEnvelope } from '../ipc/protobuf-envelope.js'
import {
  isRuntimeStreamPayload,
  type RuntimeStreamPayload,
} from '../runtime/service/protocol.js'
import { createChildLogger } from '../shared/logger.js'
import type { ServerMessage } from '../types/ws-protocol.js'

const log = createChildLogger('runtime-stream-ingress')

export interface RuntimeStreamIngress {
  close(): Promise<void>
}

export async function startRuntimeStreamIngress(options: {
  endpoint: string
  token: string
  maxFrameBytes: number
  onMessage: (message: ServerMessage) => void
}): Promise<RuntimeStreamIngress> {
  let channel: FramedSocket | undefined
  let authenticated = false
  const server = createServer((socket) => {
    if (channel) {
      socket.destroy(new Error('Runtime stream already connected'))
      return
    }
    authenticated = false
    const next = new FramedSocket(socket, { maxFrameBytes: options.maxFrameBytes })
    channel = next
    next.onMessage((envelope) => {
      void handleEnvelope(envelope, next).catch((error) => log.warn({ err: error }, 'Runtime stream rejected'))
    })
    next.onError((error) => log.warn({ err: error }, 'Runtime stream channel error'))
    socket.once('close', () => {
      if (channel === next) channel = undefined
    })
  })

  const handleEnvelope = async (envelope: IpcEnvelope, current: FramedSocket): Promise<void> => {
    if (!isRuntimeStreamPayload(envelope.payload)) return
    const payload = envelope.payload
    if (payload.type === 'runtime.hello') {
      if (payload.token !== options.token) {
        await current.close()
        return
      }
      authenticated = true
      await current.send(toEnvelope({ type: 'runtime.hello.ack' }))
      return
    }
    if (authenticated && payload.type === 'runtime.stream') options.onMessage(payload.message)
  }

  removeEndpoint(options.endpoint)
  await listen(server, options.endpoint)
  return {
    close: async () => {
      await channel?.close().catch(() => undefined)
      await closeServer(server)
      removeEndpoint(options.endpoint)
    },
  }
}

function toEnvelope(payload: RuntimeStreamPayload): IpcEnvelope {
  return {
    version: '1',
    kind: payload.type,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  }
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const onListening = (): void => { cleanup(); resolve() }
    const cleanup = (): void => {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

function removeEndpoint(endpoint: string): void {
  if (process.platform !== 'win32' && existsSync(endpoint)) rmSync(endpoint, { force: true })
}
