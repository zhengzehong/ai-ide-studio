import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { filesystemRpcHandlers } from '../../src/gateway/rpc/filesystem.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-file-asset-rpc-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('fs.assetUrl RPC', () => {
  test('normalizes a markdown-relative asset and only allows owner connections', async () => {
    const workspace = resolve(tmp, 'workspace')
    const docs = resolve(workspace, 'docs')
    const images = resolve(workspace, 'images')
    mkdirSync(docs, { recursive: true })
    mkdirSync(images, { recursive: true })
    writeFileSync(resolve(docs, 'report.md'), '# Report')
    writeFileSync(resolve(images, 'chart.png'), 'image')
    const project = projectStore.create({ name: 'Assets', workDir: workspace })
    const handler = filesystemRpcHandlers['fs.assetUrl']
    let result: unknown

    await handler({
      type: 'fs.assetUrl', projectId: project.id, filePath: '../images/chart.png', basePath: 'docs/report.md',
    }, {
      state: { authMode: 'owner', subscriptions: new Set() },
      sendResult: (value) => { result = value },
      sendError: () => undefined,
      sendOutOfBandError: () => undefined,
    })

    expect(result).toMatchObject({ path: 'images/chart.png', kind: 'image' })
    expect((result as { url: string }).url).toContain('/api/fs/asset?')
    await expect(async () => handler({
        type: 'fs.assetUrl', projectId: project.id, filePath: 'images/chart.png',
      }, {
        state: { authMode: 'guest', subscriptions: new Set() },
        sendResult: () => undefined,
        sendError: () => undefined,
        sendOutOfBandError: () => undefined,
      })).rejects.toThrow('无权访问项目文件')
  })
})

describe('fs.resolveReference RPC', () => {
  test('resolves owner file and directory references and rejects guests', async () => {
    const workspace = resolve(tmp, 'workspace')
    const external = resolve(tmp, 'external')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(external, { recursive: true })
    writeFileSync(resolve(workspace, 'report.md'), '# Report')
    const project = projectStore.create({ name: 'References', workDir: workspace })
    const handler = filesystemRpcHandlers['fs.resolveReference']
    let result: unknown

    await handler({ type: 'fs.resolveReference', projectId: project.id, reference: 'report.md' }, {
      state: { authMode: 'owner', subscriptions: new Set() },
      sendResult: (value) => { result = value },
      sendError: () => undefined,
      sendOutOfBandError: () => undefined,
    })
    expect(result).toMatchObject({ path: 'report.md', kind: 'file', absolute: false })

    await handler({ type: 'fs.resolveReference', projectId: project.id, reference: external }, {
      state: { authMode: 'owner', subscriptions: new Set() },
      sendResult: (value) => { result = value },
      sendError: () => undefined,
      sendOutOfBandError: () => undefined,
    })
    expect(result).toMatchObject({ path: external, kind: 'directory', absolute: true })

    await expect(async () => handler({ type: 'fs.resolveReference', projectId: project.id, reference: 'report.md' }, {
      state: { authMode: 'guest', subscriptions: new Set() },
      sendResult: () => undefined,
      sendError: () => undefined,
      sendOutOfBandError: () => undefined,
    })).rejects.toThrow('无权访问项目文件')
  })

  test('rejects guest reads of absolute files', async () => {
    const workspace = resolve(tmp, 'workspace')
    const outside = resolve(tmp, 'outside.md')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(outside, '# Outside')
    const project = projectStore.create({ name: 'Read boundary', workDir: workspace })
    const handler = filesystemRpcHandlers['fs.read']

    await expect(async () => handler({
      type: 'fs.read', projectId: project.id, filePath: outside,
    }, {
      state: { authMode: 'guest', subscriptions: new Set() },
      sendResult: () => undefined,
      sendError: () => undefined,
      sendOutOfBandError: () => undefined,
    })).rejects.toThrow('无权访问绝对文件')
  })
})
