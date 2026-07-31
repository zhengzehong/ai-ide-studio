import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { resolveDesktopIconPath } from '../../electron/desktop-icon.js'

describe('Electron desktop icon', () => {
  test('prefers the packaged resource icon', () => {
    const packaged = join('C:/app/resources', 'app-icon.png')
    expect(resolveDesktopIconPath({
      appPath: 'C:/app/resources/app',
      resourcesPath: 'C:/app/resources',
      exists: (path) => path === packaged,
    })).toBe(packaged)
  })

  test('falls back to the source asset during development', () => {
    const source = join('C:/workspace', 'ui', 'public', 'app-icon.png')
    expect(resolveDesktopIconPath({
      appPath: 'C:/workspace',
      resourcesPath: 'C:/electron/resources',
      exists: (path) => path === source,
    })).toBe(source)
  })

  test('returns undefined when no icon asset is available', () => {
    expect(resolveDesktopIconPath({
      appPath: 'C:/workspace',
      resourcesPath: 'C:/electron/resources',
      exists: () => false,
    })).toBeUndefined()
  })
})
