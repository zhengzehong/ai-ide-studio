import { createHash, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CredentialProtector } from '../desktop-connection.js'

export interface NodeCredential { deviceId: string; token: string; privateKey: string; enabled: boolean }

export class NodeCredentialStore {
  private readonly path: string
  constructor(directory: string, origin: string, private readonly protector: CredentialProtector) {
    const key = createHash('sha256').update(new URL(origin).origin).digest('hex')
    this.path = join(directory, `${key}.json`)
  }

  load(): NodeCredential | null {
    if (!existsSync(this.path)) return null
    const stored = JSON.parse(readFileSync(this.path, 'utf8')) as { version?: number; protectedCredential?: string }
    if (stored.version !== 1 || !stored.protectedCredential) throw new Error('设备凭证文件无效')
    const value = JSON.parse(this.protector.unprotect(stored.protectedCredential)) as NodeCredential
    if (!value.deviceId || !value.token || !value.privateKey || typeof value.enabled !== 'boolean') throw new Error('设备凭证不完整')
    return value
  }

  save(value: NodeCredential): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(`${this.path}.tmp`, JSON.stringify({ version: 1, protectedCredential: this.protector.protect(JSON.stringify(value)) }))
    renameSync(`${this.path}.tmp`, this.path)
  }

  clear(): void { rmSync(this.path, { force: true }) }
}

export function signNodeOrigin(credential: NodeCredential, sessionId: string, messageId: string, now = Date.now()): string | undefined {
  if (!credential.enabled) return undefined
  if (!sessionId || sessionId.length > 256 || !messageId || messageId.length > 256) throw new Error('消息来源签名参数无效')
  const encoded = Buffer.from(JSON.stringify({ deviceId: credential.deviceId, sessionId, messageId, issuedAt: now })).toString('base64url')
  return `${encoded}.${sign(null, Buffer.from(encoded), credential.privateKey).toString('base64url')}`
}
