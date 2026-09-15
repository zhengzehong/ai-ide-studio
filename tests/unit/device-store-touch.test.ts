import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '../../src/store/db.js'
import { deviceStore } from '../../src/store/devices.js'

let tmp: string
let dbPath: string
let deviceId: string
let lockHolder: Database.Database | undefined

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-device-touch-'))
  dbPath = resolve(tmp, 'ai-ide.sqlite')
  initDatabase(dbPath)
  deviceStore.resetTouchThrottle()
  const device = deviceStore.create({
    name: 'test-device',
    shells: ['powershell'],
    publicKey: 'pk',
    tokenHash: 'th',
  })
  deviceId = device.id
})

afterEach(() => {
  try { lockHolder?.close() } catch { /* already closed */ }
  lockHolder = undefined
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('deviceStore.touch 容错', () => {
  it('命中写锁竞争时只告警不抛错(线上崩溃根因)', () => {
    // 用第二个连接持有 WAL 写锁,并调小本连接的 busy_timeout,让 touch 稳定拿到 SQLITE_BUSY。
    getDb().pragma('busy_timeout = 50')
    lockHolder = new Database(dbPath)
    lockHolder.exec('BEGIN IMMEDIATE')
    lockHolder.prepare('UPDATE devices SET name = name WHERE id = ?').run(deviceId)

    expect(() => deviceStore.touch(deviceId, { force: true })).not.toThrow()
  })

  it('写锁释放后心跳恢复写入', () => {
    getDb().pragma('busy_timeout = 50')
    lockHolder = new Database(dbPath)
    lockHolder.exec('BEGIN IMMEDIATE')
    lockHolder.prepare('UPDATE devices SET name = name WHERE id = ?').run(deviceId)
    deviceStore.touch(deviceId, { force: true }) // 失败,被吞掉
    lockHolder.exec('COMMIT')
    lockHolder.close()
    lockHolder = undefined

    deviceStore.touch(deviceId, { force: true })
    expect(deviceStore.get(deviceId)?.last_seen_at).toBeTruthy()
  })

  it('60s 内重复心跳被内存节流,force 可绕过', () => {
    deviceStore.touch(deviceId)
    // 手工把库里的值改成哨兵:节流命中时不会被覆盖。
    getDb().prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run('1970-01-01T00:00:00.000Z', deviceId)

    deviceStore.touch(deviceId)
    expect(deviceStore.get(deviceId)?.last_seen_at).toBe('1970-01-01T00:00:00.000Z')

    deviceStore.touch(deviceId, { force: true })
    expect(deviceStore.get(deviceId)?.last_seen_at).not.toBe('1970-01-01T00:00:00.000Z')
  })

  it('不存在的设备也不会抛错', () => {
    expect(() => deviceStore.touch('device-missing', { force: true })).not.toThrow()
  })
})
