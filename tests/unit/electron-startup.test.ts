import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { createBackendLaunchOptions, resolveBackendNodeCommand } from '../../electron/backend-launch.js'

describe('Electron backend launch options', () => {
  test('uses a Node command instead of the packaged Electron executable', () => {
    expect(resolveBackendNodeCommand({
      resourcesDir: 'C:/app/resources',
      env: {},
      platform: 'win32',
      exists: () => false,
    })).toBe('node.exe')
  })

  test('prefers a packaged Node executable when it is available', () => {
    expect(resolveBackendNodeCommand({
      resourcesDir: 'C:/app/resources',
      env: {},
      platform: 'win32',
      exists: (path) => path === join('C:/app/resources', 'node', 'node.exe'),
    })).toBe(join('C:/app/resources', 'node', 'node.exe'))
  })

  test('allows an explicit backend Node command override', () => {
    expect(resolveBackendNodeCommand({
      resourcesDir: 'C:/app/resources',
      env: { AI_IDE_NODE_CMD: 'D:/runtime/node.exe' },
      platform: 'win32',
      exists: () => false,
    })).toBe('D:/runtime/node.exe')
  })

  test('passes local server settings and static assets to the backend process', () => {
    const expectedSeparator = process.platform === 'win32' ? ';' : ':'
    const options = createBackendLaunchOptions({
      command: 'node.exe',
      entryPath: 'C:/app/resources/app/electron/backend-main.js',
      port: 18800,
      token: 'local-token',
      dataDir: 'C:/Users/me/AppData/Roaming/AI IDE Studio/data',
      resourcesDir: 'C:/app/resources',
      baseEnv: { PATH: 'C:/Windows/System32', NODE_PATH: 'C:/existing/node_modules' },
      appDir: 'C:/app/resources/app.asar',
    })

    expect(options.command).toBe('node.exe')
    expect(options.args).toEqual(['C:/app/resources/app/electron/backend-main.js'])
    expect(options.env).toMatchObject({
      HOST: '127.0.0.1',
      PORT: '18800',
      DATA_DIR: 'C:/Users/me/AppData/Roaming/AI IDE Studio/data',
      AI_IDE_RUNTIME: 'electron',
      AI_IDE_LOCAL_TOKEN: 'local-token',
      AI_IDE_RESOURCES_DIR: 'C:/app/resources',
      NODE_PATH: [
        join('C:/app/resources', 'app', 'node_modules'),
        join('C:/app/resources/app.asar', 'node_modules'),
        'C:/existing/node_modules',
      ].join(expectedSeparator),
      PATH: 'C:/Windows/System32',
    })
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(options.env.STATIC_DIR).toBe(join('C:/app/resources', 'app', 'ui', 'dist'))
  })
})
