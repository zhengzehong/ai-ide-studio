import { generateKeyPairSync } from 'node:crypto'
import { hostname, homedir, release } from 'node:os'
import { join } from 'node:path'
import type { CredentialProtector } from '../desktop-connection.js'
import type { DesktopRuntimeTarget } from '../desktop-target.js'
import { NodeCredentialStore, signNodeOrigin, type NodeCredential } from './credential-store.js'
import { NodeConnector } from './connector.js'
import { detectNodeShells } from './shells.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('controller')
export interface NodeStatus {
  supported: boolean; enabled: boolean; online: boolean; machineName: string
  deviceId: string | null; shells: string[]; error?: string
}

export class NodeController {
  private readonly store: NodeCredentialStore
  private credential: NodeCredential | null = null
  private connector: NodeConnector | undefined
  private readonly shells: ReturnType<typeof detectNodeShells>
  private error: string | undefined
  private busy = false

  constructor(private readonly target: DesktopRuntimeTarget, private readonly directory: string, protector: CredentialProtector,
    private readonly paths: Record<string, string> = {}) {
    this.shells = this.supported() ? detectNodeShells() : {}
    this.store = new NodeCredentialStore(join(directory, 'credentials'), target.origin, protector)
    if (this.supported()) {
      try { this.credential = this.store.load(); if (this.credential?.enabled) this.connect() }
      catch (err) { this.error = '读取设备凭证失败，请重新配对'; log.error({ err }, '设备凭证读取失败') }
    }
  }

  status(): NodeStatus {
    return { supported: this.supported(), enabled: this.credential?.enabled ?? false, online: this.connector?.online() ?? false,
      machineName: hostname(), deviceId: this.credential?.deviceId ?? null, shells: Object.keys(this.shells),
      error: this.error ?? this.connector?.error }
  }

  async setEnabled(enabled: boolean): Promise<NodeStatus> {
    if (!this.supported()) throw new Error('仅 Windows 远程桌面客户端支持执行节点')
    if (this.busy) throw new Error('设备设置正在处理中')
    this.busy = true
    try {
      if (enabled) {
        if (!Object.keys(this.shells).length) throw new Error('没有检测到可用 PowerShell')
        if (!this.credential) await this.pair()
        else await this.ownerRequest(`/api/v1/devices/${this.credential.deviceId}`, { enabled: true })
        this.credential!.enabled = true
        this.store.save(this.credential!)
        await this.connector?.stop()
        this.connect()
      } else if (this.credential) {
        this.credential.enabled = false
        this.store.save(this.credential)
        await this.connector?.stop()
        this.connector = undefined
        try { await this.ownerRequest(`/api/v1/devices/${this.credential.deviceId}`, { enabled: false }) }
        catch (err) { log.warn({ err }, '本机已停用，服务器离线未同步停用标记') }
      }
      this.error = undefined
      return this.status()
    } finally { this.busy = false }
  }

  async unpair(): Promise<NodeStatus> {
    await this.setEnabled(false)
    if (this.credential) await this.ownerRequest(`/api/v1/devices/${this.credential.deviceId}`, { action: 'revoke' })
    this.store.clear()
    this.credential = null
    return this.status()
  }

  originProof(sessionId: string, messageId: string): string | undefined {
    if (!this.credential?.enabled || this.connector?.error) return undefined
    return signNodeOrigin(this.credential, sessionId, messageId)
  }

  async close(): Promise<void> { await this.connector?.stop() }

  private supported(): boolean { return this.target.mode === 'remote' && process.platform === 'win32' }

  private connect(): void {
    if (!this.credential) return
    this.connector = new NodeConnector(this.target.origin, this.credential,
      join(this.directory, 'jobs', this.credential.deviceId), this.shells)
    this.connector.start()
  }

  private async pair(): Promise<void> {
    const keys = generateKeyPairSync('ed25519')
    const pairing = await this.ownerRequest('/api/v1/devices/pairing', {}) as { code?: string }
    if (!pairing.code) throw new Error('服务器没有返回配对码')
    const response = await fetch(new URL('/node/pair', this.target.origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, name: hostname(), platform: 'win32', shells: Object.keys(this.shells),
        paths: { home: homedir(), logs: join(this.directory, 'jobs'), ...this.paths }, osVersion: release(),
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }),
    })
    const result = await response.json() as { deviceId?: string; token?: string; error?: string }
    if (!response.ok || !result.deviceId || !result.token) throw new Error(result.error ?? '设备配对失败')
    this.credential = { deviceId: result.deviceId, token: result.token, enabled: false,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
    this.store.save(this.credential)
  }

  private async ownerRequest(path: string, body: object): Promise<unknown> {
    const response = await fetch(new URL(path, this.target.origin), {
      method: 'POST', redirect: 'error', headers: { 'x-ai-ide-token': this.target.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) throw new Error(result.error ?? '设备授权操作失败')
    return result
  }
}
