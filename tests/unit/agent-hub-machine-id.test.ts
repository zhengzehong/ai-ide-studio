import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { settingsStore } from '../../src/store/settings.js'
import { getOrCreateMachineId, resetCachedMachineIdForTest } from '../../src/core/agent-hub/machine-id.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-hub-machine-id-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
  resetCachedMachineIdForTest()
})

afterEach(() => {
  resetCachedMachineIdForTest()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent-hub machine-id', () => {
  test('首次调用生成 mac- 前缀 ID 并持久化到 settings 表', async () => {
    const id = await getOrCreateMachineId()
    expect(id).toMatch(/^mac-[a-f0-9]{8}$/)

    const persisted = settingsStore.get('machineId')
    expect(persisted).toBe(id)
  })

  test('第二次调用返回缓存值,不重复写库', async () => {
    const first = await getOrCreateMachineId()
    const spy = vi.spyOn(settingsStore, 'get')
    const second = await getOrCreateMachineId()
    expect(second).toBe(first)
    expect(spy).not.toHaveBeenCalled()
  })

  test('并发调用复用同一个 promise,不会生成多个 ID', async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateMachineId(),
      getOrCreateMachineId(),
      getOrCreateMachineId(),
    ])
    expect(a).toBe(b)
    expect(b).toBe(c)
    const persisted = settingsStore.get('machineId')
    expect(persisted).toBe(a)
  })

  test('已持久化的 ID 复用,不重新生成', async () => {
    settingsStore.set('machineId', 'mac-preexist1')
    const id = await getOrCreateMachineId()
    expect(id).toBe('mac-preexist1')
  })

  test('reset 后重新从库里读', async () => {
    const first = await getOrCreateMachineId()
    resetCachedMachineIdForTest()
    const second = await getOrCreateMachineId()
    expect(second).toBe(first)
  })
})
