import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { deviceStore } from '../../src/store/devices.js'
import { authenticateDevice, issueDevicePairing, pairDevice, verifyDeviceOrigin } from '../../src/devices/auth.js'
import { beginDeviceOrigin, endDeviceOrigin, getCurrentOriginDeviceId } from '../../src/devices/prompt-origin.js'

let dir: string
const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
let address = 0

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'device-auth-')); initDatabase(join(dir, 'test.sqlite')) })
afterEach(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }) })

function pair(): { deviceId: string; token: string } {
  return pairDevice({ ...issueDevicePairing(), platform: 'win32', name: 'Office PC', shells: ['powershell'], publicKey }, `test-${++address}`)
}

function proof(deviceId: string, issuedAt = Date.now()): string {
  const encoded = Buffer.from(JSON.stringify({ deviceId, sessionId: 's', messageId: 'm', issuedAt })).toString('base64url')
  return `${encoded}.${sign(null, Buffer.from(encoded), keys.privateKey).toString('base64url')}`
}

describe('remote device credentials and source identity', () => {
  it('consumes pairing once and only accepts supported execution clients', () => {
    const input = { ...issueDevicePairing(), platform: 'android', name: 'PC', shells: ['powershell'], publicKey }
    expect(() => pairDevice(input, `test-${++address}`)).toThrow('Windows')
    input.platform = 'win32'
    const result = pairDevice(input, `test-${++address}`)
    expect(() => pairDevice(input, `test-${++address}`)).toThrow('已使用')
    expect(authenticateDevice(`Bearer ${result.token}`)?.id).toBe(result.deviceId)
    expect(deviceStore.get(result.deviceId)?.token_hash).not.toContain(result.token)
    expect(authenticateDevice('Bearer owner-token')).toBeUndefined()
  })

  it('binds proof to device, session, message and time; rejects spoofing and revoked devices', () => {
    const { deviceId } = pair()
    expect(verifyDeviceOrigin(proof(deviceId), 's', 'm')).toBe(deviceId)
    expect(verifyDeviceOrigin(undefined, 's', 'm')).toBeUndefined()
    expect(() => verifyDeviceOrigin(proof(deviceId), 'other', 'm')).toThrow()
    expect(() => verifyDeviceOrigin(proof(deviceId), 's', 'other')).toThrow()
    expect(() => verifyDeviceOrigin(proof(deviceId, Date.now() - 301_000), 's', 'm')).toThrow()
    expect(() => verifyDeviceOrigin(`${proof(deviceId)}x`, 's', 'm')).toThrow()
    deviceStore.setEnabled(deviceId, false)
    expect(() => verifyDeviceOrigin(proof(deviceId), 's', 'm')).toThrow()
    deviceStore.setEnabled(deviceId, true)
    deviceStore.revoke(deviceId)
    expect(() => verifyDeviceOrigin(proof(deviceId), 's', 'm')).toThrow()
    expect(deviceStore.list()).toHaveLength(0)
  })

  it('does not reuse a PC origin for mobile, automation, conflicting batches or a later turn', () => {
    beginDeviceOrigin('s', '1', [{ source: 'user', options: { originDeviceId: 'pc' } }])
    expect(getCurrentOriginDeviceId('s')).toBe('pc')
    beginDeviceOrigin('s', '2', [{ source: 'user', options: {} }])
    endDeviceOrigin('s', '1')
    expect(getCurrentOriginDeviceId('s')).toBeUndefined()
    beginDeviceOrigin('s', '3', [{ source: 'platform', options: { originDeviceId: 'pc' } }])
    expect(getCurrentOriginDeviceId('s')).toBeUndefined()
    beginDeviceOrigin('s', '4', [
      { source: 'user', options: { originDeviceId: 'pc' } }, { source: 'user', options: {} },
    ])
    expect(getCurrentOriginDeviceId('s')).toBeUndefined()
    endDeviceOrigin('s', '4')
  })
})
