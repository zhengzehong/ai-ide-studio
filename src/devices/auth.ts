import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { deviceStore, type DeviceRow } from '../store/devices.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('devices:auth')
const attempts = new Map<string, { count: number; resetAt: number }>()
export const ORIGIN_PROOF_TTL_MS = 5 * 60_000

export function hashDeviceSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function issueDevicePairing(): { code: string; expiresAt: number } {
  const code = randomBytes(9).toString('hex').toUpperCase()
  const expiresAt = Date.now() + 5 * 60_000
  deviceStore.issuePairing(hashDeviceSecret(code), expiresAt)
  log.info('设备配对码已生成')
  return { code, expiresAt }
}

export function pairDevice(input: unknown, remoteAddress: string): { deviceId: string; token: string } {
  limitPairingAttempts(remoteAddress)
  if (!isRecord(input) || input.platform !== 'win32') throw new Error('仅支持 Windows 桌面执行节点')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error('设备名称无效')
  if (typeof input.code !== 'string' || typeof input.publicKey !== 'string' || input.publicKey.length > 2048) throw new Error('配对参数无效')
  const key = createPublicKey(input.publicKey)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('设备公钥无效')
  if (!Array.isArray(input.shells) || !input.shells.length || input.shells.some((shell) => shell !== 'powershell' && shell !== 'pwsh')) {
    throw new Error('设备 Shell 信息无效')
  }
  const token = randomBytes(32).toString('base64url')
  const paths: Record<string, string> = {}
  if (isRecord(input.paths)) for (const name of ['home', 'desktop', 'downloads', 'logs']) {
    const path = input.paths[name]
    if (typeof path === 'string' && path.length <= 8192) paths[name] = path
  }
  const row = deviceStore.consumePairing(hashDeviceSecret(input.code.trim().toUpperCase()), () => deviceStore.create({
    name: (input.name as string).trim(), shells: [...new Set(input.shells as string[])],
    publicKey: input.publicKey as string, tokenHash: hashDeviceSecret(token),
    paths, osVersion: typeof input.osVersion === 'string' ? input.osVersion.slice(0, 120) : '',
  }))
  log.info({ deviceId: row.id, name: row.name }, '设备配对完成')
  return { deviceId: row.id, token }
}

export function authenticateDevice(authorization: string | undefined): DeviceRow | undefined {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1]
  return token ? deviceStore.authenticate(hashDeviceSecret(token)) : undefined
}

export function verifyDeviceOrigin(proof: unknown, sessionId: string, messageId: string, now = Date.now()): string | undefined {
  if (proof == null) return undefined
  if (typeof proof !== 'string' || proof.length > 4096) throw new Error('消息来源设备签名无效')
  try {
    const [encoded, signature, extra] = proof.split('.')
    if (!encoded || !signature || extra) throw new Error('invalid proof')
    const claims: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!isRecord(claims) || typeof claims.deviceId !== 'string' || claims.sessionId !== sessionId
      || claims.messageId !== messageId || typeof claims.issuedAt !== 'number'
      || claims.issuedAt > now + 30_000 || now - claims.issuedAt > ORIGIN_PROOF_TTL_MS) throw new Error('invalid claims')
    const device = deviceStore.get(claims.deviceId)
    if (!device?.enabled || device.revoked_at
      || !verify(null, Buffer.from(encoded), device.public_key, Buffer.from(signature, 'base64url'))) throw new Error('invalid signature')
    return device.id
  } catch {
    log.warn({ sessionId, messageId }, '消息来源设备验证失败')
    throw new Error('消息来源设备签名无效或已过期，请重新发送')
  }
}

function limitPairingAttempts(key: string): void {
  const now = Date.now()
  for (const [address, value] of attempts) if (value.resetAt <= now) attempts.delete(address)
  if (!attempts.has(key) && attempts.size >= 1024) throw new Error('配对请求过多，请稍后重试')
  const bucket = attempts.get(key) ?? { count: 0, resetAt: now + 60_000 }
  attempts.set(key, bucket)
  if (++bucket.count > 10) throw new Error('配对尝试过多，请稍后重试')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
