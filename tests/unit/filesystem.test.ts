import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { inspectFile, readFile } from '../../src/core/filesystem.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-filesystem-'))
  mkdirSync(tmp, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('filesystem readFile', () => {
  test('rejects sensitive files hidden from the file tree even when the path is known', () => {
    writeFileSync(resolve(tmp, '.env'), 'SECRET=env\n', 'utf-8')
    writeFileSync(resolve(tmp, '.env.local'), 'SECRET=local\n', 'utf-8')
    writeFileSync(resolve(tmp, '.npmrc'), '//registry.example/:_authToken=token\n', 'utf-8')

    expect(readFile(tmp, '.env')).toBeNull()
    expect(readFile(tmp, '.env.local')).toBeNull()
    expect(readFile(tmp, '.npmrc')).toBeNull()
  })

  test('allows env examples that are visible in the file tree', () => {
    writeFileSync(resolve(tmp, '.env.example'), 'SECRET=\n', 'utf-8')

    expect(readFile(tmp, '.env.example')).toMatchObject({
      path: '.env.example',
      content: 'SECRET=\n',
      language: 'plaintext',
    })
  })

  test('allows an explicit absolute path outside the workspace', () => {
    const workspace = resolve(tmp, 'workspace')
    const outsideFile = resolve(tmp, 'outside.md')
    mkdirSync(workspace)
    writeFileSync(outsideFile, '# Outside', 'utf-8')

    expect(readFile(workspace, outsideFile)).toMatchObject({
      path: outsideFile,
      content: '# Outside',
      kind: 'text',
    })
    expect(inspectFile(workspace, outsideFile)).toMatchObject({
      path: outsideFile,
      name: 'outside.md',
      kind: 'text',
    })
  })

  test('allows an explicit absolute hidden file path', () => {
    const workspace = resolve(tmp, 'workspace')
    const hiddenFile = resolve(tmp, '.env')
    mkdirSync(workspace)
    writeFileSync(hiddenFile, 'SECRET=allowed-by-absolute-path\n', 'utf-8')

    expect(readFile(workspace, hiddenFile)).toMatchObject({
      path: hiddenFile,
      content: 'SECRET=allowed-by-absolute-path\n',
    })
  })

  test('continues to reject traversal from a workspace-relative path', () => {
    const workspace = resolve(tmp, 'workspace')
    mkdirSync(workspace)
    writeFileSync(resolve(tmp, 'outside.md'), '# Outside', 'utf-8')

    expect(readFile(workspace, '../outside.md')).toBeNull()
  })
})
