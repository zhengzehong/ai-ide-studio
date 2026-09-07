import { WebSocket } from 'ws'
import { NodeExecutor } from './executor.js'
import { createChildLogger } from './logger.js'
import type { NodeCredential } from './credential-store.js'

const log = createChildLogger('connector')

export class NodeConnector {
  private socket: WebSocket | undefined
  private generation: string | undefined
  private retry: NodeJS.Timeout | undefined
  private heartbeat: NodeJS.Timeout | undefined
  private stopped = false
  private attempts = 0
  private readonly executor: NodeExecutor
  error: string | undefined

  constructor(private readonly origin: string, private readonly credential: NodeCredential,
    directory: string, shells: Partial<Record<'powershell' | 'pwsh', string>>) {
    this.executor = new NodeExecutor(directory, shells, origin, credential.token, (frame) => {
      if (this.socket?.readyState === WebSocket.OPEN && this.generation) {
        if (this.socket.bufferedAmount > 16 * 1024 * 1024) { this.socket.terminate(); return }
        this.socket.send(JSON.stringify({ ...frame, version: 1, generation: this.generation }))
      }
    })
  }

  online(): boolean { return this.socket?.readyState === WebSocket.OPEN && !!this.generation }

  start(): void {
    if (this.stopped) return
    const url = new URL('/node-ws', this.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${this.credential.token}` },
      handshakeTimeout: 10_000, maxPayload: 256 * 1024, followRedirects: false })
    this.socket = socket
    this.generation = undefined
    const beat = (): void => {
      clearTimeout(this.heartbeat)
      this.heartbeat = setTimeout(() => socket.terminate(), 45_000)
    }
    socket.on('ping', beat)
    socket.on('open', beat)
    socket.on('message', (raw, binary) => {
      if (this.socket !== socket || this.stopped) return
      try {
        if (binary) throw new Error('设备协议帧无效')
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>
        if (frame.version !== 1 || typeof frame.generation !== 'string') throw new Error('设备协议版本无效')
        if (frame.type === 'welcome') {
          if (this.generation || frame.deviceId !== this.credential.deviceId) throw new Error('设备身份不匹配')
          this.generation = frame.generation
          this.attempts = 0
          this.error = undefined
          log.info({ deviceId: this.credential.deviceId }, '远程执行连接已建立')
          return
        }
        if (!this.generation || frame.generation !== this.generation) throw new Error('设备连接代次不匹配')
        this.executor.receive(frame)
      } catch (err) {
        log.warn({ err }, '远程执行消息无效')
        socket.close(1008, '设备协议错误')
      }
    })
    socket.on('error', (err) => { this.error = '远程执行连接失败'; log.warn({ err }, '设备连接失败') })
    socket.on('unexpected-response', (_request, response) => {
      if (response.statusCode === 401) { this.error = '设备授权已停用或撤销'; this.stopped = true; void this.executor.stop() }
      response.resume()
      socket.terminate()
    })
    socket.on('close', (code) => {
      if (this.socket !== socket) return
      clearTimeout(this.heartbeat)
      this.generation = undefined
      if (code === 1008) { this.error = '设备连接已停用或被替换'; this.stopped = true; void this.executor.stop() }
      if (!this.stopped) this.retry = setTimeout(() => this.start(), Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)))
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.retry); clearTimeout(this.heartbeat)
    await this.executor.stop()
    this.socket?.close(1000, '执行节点已关闭')
    this.socket?.terminate()
    this.generation = undefined
  }
}
