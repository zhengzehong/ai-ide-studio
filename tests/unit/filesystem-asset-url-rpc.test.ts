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
