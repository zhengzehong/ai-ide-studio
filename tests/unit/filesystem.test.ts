import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readFile } from '../../src/core/filesystem.js'

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
})
