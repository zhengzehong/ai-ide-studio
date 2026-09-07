import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

export interface DeviceRow {
  id: string
  name: string
  platform: 'win32'
  shells_json: string
  paths_json: string
  os_version: string
  public_key: string
  token_hash: string
  enabled: number
  revoked_at: string | null
  last_seen_at: string | null
  created_at: string
}

export const deviceStore = {
  list(): DeviceRow[] {
    return getDb().prepare<[], DeviceRow>('SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY created_at, id').all()
  },
  get(id: string): DeviceRow | undefined {
    return getDb().prepare<[string], DeviceRow>('SELECT * FROM devices WHERE id = ?').get(id)
  },
  authenticate(tokenHash: string): DeviceRow | undefined {
    return getDb().prepare<[string], DeviceRow>(
      'SELECT * FROM devices WHERE token_hash = ? AND enabled = 1 AND revoked_at IS NULL',
    ).get(tokenHash)
  },
  create(input: { name: string; shells: string[]; publicKey: string; tokenHash: string; paths?: Record<string, string>; osVersion?: string }): DeviceRow {
    const row: DeviceRow = {
      id: `device-${randomUUID()}`, name: input.name, platform: 'win32',
      shells_json: JSON.stringify(input.shells), public_key: input.publicKey,
      paths_json: JSON.stringify(input.paths ?? {}), os_version: input.osVersion ?? '',
      token_hash: input.tokenHash, enabled: 1, revoked_at: null, last_seen_at: null,
      created_at: new Date().toISOString(),
    }
    getDb().prepare(`INSERT INTO devices
      (id, name, platform, shells_json, paths_json, os_version, public_key, token_hash, enabled, created_at)
      VALUES (@id, @name, @platform, @shells_json, @paths_json, @os_version, @public_key, @token_hash, @enabled, @created_at)`).run(row)
    return row
  },
  setEnabled(id: string, enabled: boolean): void {
    getDb().prepare('UPDATE devices SET enabled = ? WHERE id = ? AND revoked_at IS NULL').run(Number(enabled), id)
  },
  revoke(id: string): void {
    getDb().prepare('UPDATE devices SET enabled = 0, revoked_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  },
  touch(id: string): void {
    getDb().prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  },
  issuePairing(codeHash: string, expiresAt: number): void {
    getDb().prepare('DELETE FROM device_pairings WHERE expires_at < ?').run(Date.now())
    getDb().prepare('INSERT INTO device_pairings(code_hash, expires_at) VALUES (?, ?)').run(codeHash, expiresAt)
  },
  consumePairing<T>(codeHash: string, create: () => T): T {
    return getDb().transaction(() => {
      const result = getDb().prepare(`UPDATE device_pairings SET consumed_at = ?
        WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?`).run(Date.now(), codeHash, Date.now())
      if (result.changes !== 1) throw new Error('配对码无效、已使用或已过期')
      return create()
    })()
  },
}
