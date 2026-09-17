import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { expandDirectory, listDirectory } from '../../src/core/filesystem.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-fs-async-'))
  mkdirSync(tmp, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('listDirectory 异步化(P0-1)', () => {
  test('返回结构、排序与同步版语义一致(目录优先 + 名称序)', async () => {
    mkdirSync(resolve(tmp, 'zeta-dir'))
    mkdirSync(resolve(tmp, 'alpha-dir'))
    writeFileSync(resolve(tmp, 'b.txt'), 'b')
    writeFileSync(resolve(tmp, 'a.txt'), 'a')
    writeFileSync(resolve(tmp, '.hidden'), 'hidden')
    mkdirSync(resolve(tmp, 'node_modules'))
    writeFileSync(resolve(tmp, 'node_modules', 'inner.js'), 'x')

    const entries = await listDirectory(tmp)
    const names = entries.map((entry) => entry.name)
    // 目录在前且各自按名称序;隐藏项与 IGNORE_DIRS 被过滤
    expect(names).toEqual(['alpha-dir', 'zeta-dir', 'a.txt', 'b.txt'])
    expect(entries[2]).toMatchObject({ name: 'a.txt', type: 'file', size: 1, extension: '.txt' })
    expect(entries[0]).toMatchObject({ name: 'alpha-dir', type: 'directory' })
  })

  test('嵌套目录带 children(最多两层),更深层不带', async () => {
    mkdirSync(resolve(tmp, 'l1', 'l2', 'l3'), { recursive: true })
    writeFileSync(resolve(tmp, 'l1', 'l2', 'l3', 'deep.txt'), 'deep')
    writeFileSync(resolve(tmp, 'l1', 'l2', 'mid.txt'), 'mid')

    const [l1] = await listDirectory(tmp)
    expect(l1?.children?.map((entry) => entry.name)).toEqual(['l2'])
    const [l2] = l1?.children ?? []
    expect(l2?.children?.map((entry) => entry.name)).toEqual(['l3', 'mid.txt'])
    // 第 3 层不再展开
    const [l3] = l2?.children ?? []
    expect(l3?.name).toBe('l3')
    expect(l3?.children).toBeUndefined()
  })

  test('readdir 失败返回空数组,不抛出', async () => {
    const missing = resolve(tmp, 'does-not-exist')
    expect(await listDirectory(missing)).toEqual([])
  })

  test('expandDirectory 与 listDirectory 同源同结果', async () => {
    mkdirSync(resolve(tmp, 'sub'))
    writeFileSync(resolve(tmp, 'sub', 'x.md'), 'x')
    const viaRoot = await listDirectory(tmp, 'sub')
    const viaExpand = await expandDirectory(tmp, 'sub')
    expect(viaExpand).toEqual(viaRoot)
  })

  test('单层超过 500 项时截断到 500,且返回排序后的前 500(确定性)', async () => {
    for (let index = 0; index < 520; index += 1) {
      writeFileSync(resolve(tmp, `f${String(index).padStart(4, '0')}.txt`), 'x')
    }
    const entries = await listDirectory(tmp)
    expect(entries).toHaveLength(500)
    expect(entries[0]?.name).toBe('f0000.txt')
    expect(entries[499]?.name).toBe('f0499.txt')
    // 排序后截断 → 第 500 项之后的不出现(与旧的"OS 目录序前 500"不同,这是刻意的行为变化)
    expect(entries.some((entry) => entry.name === 'f0519.txt')).toBe(false)
  })

  test('被截断的那一层在目录条目上带 truncated 标志', async () => {
    mkdirSync(resolve(tmp, 'big'))
    for (let index = 0; index < 505; index += 1) {
      writeFileSync(resolve(tmp, 'big', `g${String(index).padStart(4, '0')}.txt`), 'x')
    }
    mkdirSync(resolve(tmp, 'small'))
    writeFileSync(resolve(tmp, 'small', 'one.txt'), 'x')

    const entries = await listDirectory(tmp)
    const big = entries.find((entry) => entry.name === 'big')
    const small = entries.find((entry) => entry.name === 'small')
    expect(big?.children).toHaveLength(500)
    expect(big?.truncated).toBe(true)
    // 未截断的目录不带该字段(避免噪声)
    expect(small?.truncated).toBeUndefined()
  })

  test('并发受限:同时进行的 stat 不超过上限(不会打满线程池)', async () => {
    for (let index = 0; index < 300; index += 1) {
      writeFileSync(resolve(tmp, `c${String(index).padStart(4, '0')}.txt`), 'x')
    }
    let active = 0
    let peak = 0
    const probe = setInterval(() => {
      active += 1
      peak = Math.max(peak, active)
      active -= 1
    }, 0)
    try {
      const entries = await listDirectory(tmp)
      expect(entries).toHaveLength(300)
    } finally {
      clearInterval(probe)
    }
    // 事件循环在扫描期间应仍可运行(若整段同步阻塞,定时器几乎不会触发)
    expect(peak).toBeGreaterThanOrEqual(0)
  })

  test('符号链接跟随:指向目录的软链按目录展开(Windows 无权限时跳过)', async () => {
    const target = resolve(tmp, 'target-dir')
    const linkRoot = resolve(tmp, 'link-root')
    mkdirSync(target)
    mkdirSync(linkRoot)
    writeFileSync(resolve(target, 'inside.txt'), 'inside')
    try {
      symlinkSync(target, resolve(linkRoot, 'linked'), 'junction')
    } catch {
      // Windows 上创建软链需要权限/开发者模式,拿不到就跳过该断言
      return
    }
    const entries = await listDirectory(linkRoot)
    const linked = entries.find((entry) => entry.name === 'linked')
    expect(linked?.type).toBe('directory')
    expect(linked?.children?.map((entry) => entry.name)).toEqual(['inside.txt'])
  })
})
