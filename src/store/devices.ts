import { randomUUID } from 'node:crypto'
import { createChildLogger } from '../core/logger.js'
import { getDb } from './db.js'

const log = createChildLogger('store:devices')

/** 心跳落库节流窗口:同一设备 60s 内只写一次 last_seen_at(粗粒度心跳足够)。 */
export const DEVICE_TOUCH_THROTTLE_MS = 60_000
/** 节流表上限:设备数量有限,超过只可能是异常输入,直接重置避免无界增长。 */
const TOUCH_THROTTLE_MAX_ENTRIES = 256
const lastPersistedTouchAt = new Map<string, number>()

const LOCK_ERROR_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_BUSY_SNAPSHOT',
  'SQLITE_LOCKED',
  'SQLITE_LOCKED_SHAREDCACHE',
])

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
  /**
   * 设备心跳:写 last_seen_at。属于"尽力而为"的旁路信息,约定永不向上抛错:
   * - 60s 内存节流(force=true 用于连接建立等需要立即落库的场景);
   * - 写锁竞争(SQLITE_BUSY 家族)只告警。该调用位于 15s 心跳定时器回调里,
   *   抛出会成为未捕获异常直接杀掉 API 子进程(2026-09-10 / 09-15 两次线上崩溃根因);
   * - 其它错误(如 SQLITE_FULL)同样只告警:丢一次心跳不影响设备可用性判定。
   */
  touch(id: string, options: { force?: boolean } = {}): void {
    const now = Date.now()
    const lastPersistedAt = lastPersistedTouchAt.get(id)
    if (!options.force && lastPersistedAt != null && now - lastPersistedAt < DEVICE_TOUCH_THROTTLE_MS) return
    try {
      getDb().prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), id)
      if (!lastPersistedTouchAt.has(id) && lastPersistedTouchAt.size >= TOUCH_THROTTLE_MAX_ENTRIES) {
        lastPersistedTouchAt.clear()
      }
      lastPersistedTouchAt.set(id, now)
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code
      if (typeof code === 'string' && LOCK_ERROR_CODES.has(code)) {
        log.warn({ err, deviceId: id, code }, '设备心跳写入遇到写锁竞争,已跳过本次心跳')
        return
      }
      log.warn({ err, deviceId: id }, '设备心跳写入失败,已跳过本次心跳')
    }
  },
  /** 仅供测试:重置心跳节流状态。 */
  resetTouchThrottle(): void {
    lastPersistedTouchAt.clear()
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
