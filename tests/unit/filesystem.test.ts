import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { inspectFile, inspectFileReference, listDirectory, readFile, resolveFileReference } from '../../src/core/filesystem.js'
import { parseByteRange } from '../../src/core/file-byte-range.js'

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

  test('classifies common audio and video files without probing them as text', () => {
    writeFileSync(resolve(tmp, 'voice.mp3'), Buffer.from('ID3 text-like media payload'))
    writeFileSync(resolve(tmp, 'clip.mp4'), Buffer.from('text-like mp4 payload'))

    expect(inspectFile(tmp, 'voice.mp3')).toMatchObject({ kind: 'audio', extension: '.mp3' })
    expect(readFile(tmp, 'clip.mp4')).toMatchObject({ kind: 'video', content: '' })
  })

  test('resolves markdown resources relative to project and absolute documents', () => {
    const docs = resolve(tmp, 'docs')
    const assets = resolve(tmp, 'assets')
    const outside = resolve(tmp, '..', `${Date.now()}-outside.png`)
    mkdirSync(docs)
    mkdirSync(assets)
    writeFileSync(resolve(docs, 'report.md'), '# Report')
    writeFileSync(resolve(assets, 'chart.png'), 'image')
    writeFileSync(outside, 'outside')

    try {
      expect(resolveFileReference(tmp, '../assets/chart.png', 'docs/report.md')).toBe('assets/chart.png')
      expect(resolveFileReference(tmp, '/assets/chart.png', 'docs/report.md')).toBe('assets/chart.png')
      expect(resolveFileReference(tmp, outside, 'docs/report.md')).toBe(outside)
      expect(resolveFileReference(tmp, pathToFileURL(outside).toString(), 'docs/report.md')).toBe(outside)
      expect(resolveFileReference(tmp, '../../outside.png', 'docs/report.md')).toBeNull()
    } finally {
      rmSync(outside, { force: true })
    }
  })

  test('inspects files and directories from chat references', () => {
    const workspace = resolve(tmp, 'workspace')
    const external = resolve(tmp, 'external')
    mkdirSync(resolve(workspace, 'docs'), { recursive: true })
    mkdirSync(external, { recursive: true })
    writeFileSync(resolve(workspace, 'docs', 'guide.md'), '# Guide')
    writeFileSync(resolve(external, 'outside.txt'), 'outside')

    expect(inspectFileReference(workspace, 'docs/guide.md')).toMatchObject({
      path: 'docs/guide.md', name: 'guide.md', kind: 'file', absolute: false,
    })
    expect(inspectFileReference(workspace, external)).toMatchObject({
      path: external, name: 'external', kind: 'directory', absolute: true,
    })
    expect(inspectFileReference(workspace, 'missing.md')).toBeNull()
  })

  test('lists an absolute directory with absolute child paths', () => {
    const workspace = resolve(tmp, 'workspace')
    const external = resolve(tmp, 'external')
    mkdirSync(workspace)
    mkdirSync(resolve(external, 'nested'), { recursive: true })
    writeFileSync(resolve(external, 'readme.md'), '# External')

    const entries = listDirectory(workspace, external)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'nested', path: resolve(external, 'nested'), type: 'directory' }),
      expect.objectContaining({ name: 'readme.md', path: resolve(external, 'readme.md'), type: 'file' }),
    ]))
  })

  test('parses single HTTP byte ranges', () => {
    expect(parseByteRange(undefined, 100)).toBeNull()
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=100-120', 100)).toBe('invalid')
    expect(parseByteRange('bytes=0-1,4-5', 100)).toBe('invalid')
  })
})
