import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { createChildLogger } from '../core/logger.js'
import { deviceStore } from '../store/devices.js'
import { authenticateDevice } from './auth.js'
import { DEVICE_PROTOCOL_VERSION, MAX_DEVICE_FRAME_BYTES, parseDeviceFrame } from './protocol.js'

const log = createChildLogger('devices:connections')
interface Connection { socket: WebSocket; generation: string; alive: boolean }

export class DeviceConnections {
  private readonly peers = new Map<string, Connection>()
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_DEVICE_FRAME_BYTES })
  private readonly heartbeat: NodeJS.Timeout

  constructor(private readonly handlers: {
    connected: (deviceId: string) => void
    disconnected: (deviceId: string) => void
    message: (deviceId: string, frame: Record<string, unknown>) => void
  }) {
    this.heartbeat = setInterval(() => this.tick(), 15_000)
    this.heartbeat.unref()
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/node-ws') return false
    const device = authenticateDevice(request.headers.authorization)
    if (!device) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return true
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(device.id, ws))
    return true
  }

  online(deviceId: string): boolean {
    return this.peers.get(deviceId)?.socket.readyState === WebSocket.OPEN
  }

  send(deviceId: string, frame: Record<string, unknown>): void {
    const peer = this.peers.get(deviceId)
    const device = deviceStore.get(deviceId)
    if (!peer || !device?.enabled || device.revoked_at || peer.socket.readyState !== WebSocket.OPEN) {
      throw new Error('目标设备离线或已停用；不会切换到其他设备执行')
    }
    peer.socket.send(JSON.stringify({ ...frame, version: DEVICE_PROTOCOL_VERSION, generation: peer.generation }))
  }

  disconnect(deviceId: string): void {
    const peer = this.peers.get(deviceId)
    if (!peer) return
    this.peers.delete(deviceId)
    peer.socket.close(1008, '设备已停用')
    this.handlers.disconnected(deviceId)
  }

  close(): void {
    clearInterval(this.heartbeat)
    for (const [id, peer] of this.peers) {
      this.peers.delete(id)
      peer.socket.terminate()
      this.handlers.disconnected(id)
    }
    this.wss.close()
  }

  private accept(deviceId: string, socket: WebSocket): void {
    const old = this.peers.get(deviceId)
    const peer = { socket, generation: randomUUID(), alive: true }
    this.peers.set(deviceId, peer)
    old?.socket.close(1008, '设备连接已替换')
    socket.on('pong', () => { peer.alive = true })
    socket.on('error', (err) => log.warn({ err, deviceId }, '设备连接错误'))
    socket.on('close', () => {
      if (this.peers.get(deviceId) !== peer) return
      this.peers.delete(deviceId)
      this.handlers.disconnected(deviceId)
      log.info({ deviceId }, '设备离线')
    })
    socket.on('message', (raw, binary) => {
      if (this.peers.get(deviceId) !== peer) return
      try {
        if (binary) throw new Error('不支持二进制控制帧')
        const device = deviceStore.get(deviceId)
        if (!device?.enabled || device.revoked_at) throw new Error('设备已停用')
        const frame = parseDeviceFrame(raw.toString())
        if (frame.generation !== peer.generation) throw new Error('连接代次不匹配')
        this.handlers.message(deviceId, frame)
      } catch (err) {
        log.warn({ err, deviceId }, '设备消息被拒绝')
        socket.close(1008, '设备消息无效')
      }
    })
    deviceStore.touch(deviceId)
    this.send(deviceId, { type: 'welcome', deviceId })
    this.handlers.connected(deviceId)
    log.info({ deviceId, generation: peer.generation }, '设备已连接')
  }

  private tick(): void {
    for (const [id, peer] of this.peers) {
      const device = deviceStore.get(id)
      if (!device?.enabled || device.revoked_at) { this.disconnect(id); continue }
      if (!peer.alive) { peer.socket.terminate(); continue }
      peer.alive = false
      peer.socket.ping()
      deviceStore.touch(id)
    }
  }
}
