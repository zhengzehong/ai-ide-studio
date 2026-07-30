import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DesktopConnectionStore,
  normalizeRemoteOrigin,
  toConnectionSettings,
  type CredentialProtector,
} from '../../electron/desktop-connection.js'
import { probeDesktopConnection } from '../../electron/desktop-connection-probe.js'
import { createDesktopUrl, createManagedLocalTarget, createRemoteTarget } from '../../electron/desktop-target.js'

const temporaryDirectories: string[] = []
const credentials: CredentialProtector = {
  protect: (value) => `protected:${Buffer.from(value).toString('base64')}`,
  unprotect: (value) => Buffer.from(value.replace(/^protected:/, ''), 'base64').toString(),
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop connection profiles', () => {
  test('persists a protected remote credential and exposes only its presence in settings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ide-desktop-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'desktop-connection.json')
    const store = new DesktopConnectionStore(filePath, credentials)

    const saved = store.save({
      mode: 'remote',
      remoteOrigin: 'https://ide.example.com/',
      token: 'secret-token',
      widgetEnabled: false,
    })

    expect(saved).toEqual({
      mode: 'remote',
      remoteOrigin: 'https://ide.example.com',
      token: 'secret-token',
      widgetEnabled: false,
    })
    expect(readFileSync(filePath, 'utf8')).not.toContain('secret-token')
    expect(store.load()).toEqual(saved)
    expect(toConnectionSettings(saved)).toEqual({
      mode: 'remote',
      remoteOrigin: 'https://ide.example.com',
      widgetEnabled: false,
      hasStoredToken: true,
    })
  })

  test('keeps the existing remote token when settings submit an empty token', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ide-desktop-'))
    temporaryDirectories.push(directory)
    const store = new DesktopConnectionStore(join(directory, 'desktop-connection.json'), credentials)
    store.save({ mode: 'remote', remoteOrigin: 'https://one.example', token: 'kept', widgetEnabled: true })

    expect(store.save({
      mode: 'remote',
      remoteOrigin: 'https://two.example',
      token: '',
      widgetEnabled: true,
    }).token).toBe('kept')
  })

  test('rejects paths, credentials, and unsupported protocols in a remote origin', () => {
    expect(() => normalizeRemoteOrigin('https://example.com/base')).toThrow('origin')
    expect(() => normalizeRemoteOrigin('https://user:pass@example.com')).toThrow('账号或密码')
    expect(() => normalizeRemoteOrigin('file:///tmp/app')).toThrow('HTTP')
  })
})

describe('desktop runtime targets', () => {
  test('creates an owned local target and authenticated URLs', () => {
    const target = createManagedLocalTarget(18800, 'local-token', true)
    expect(target.ownsBackend).toBe(true)
    expect(createDesktopUrl(target, '/widget')).toBe('http://127.0.0.1:18800/widget?token=local-token')
  })

  test('creates a non-owned remote target', () => {
    const target = createRemoteTarget({
      mode: 'remote',
      remoteOrigin: 'https://ide.example.com',
      token: 'remote-token',
      widgetEnabled: false,
    })
    expect(target).toMatchObject({ ownsBackend: false, widgetEnabled: false })
    expect(createDesktopUrl(target, '/workspace')).toBe('https://ide.example.com/workspace?token=remote-token')
  })
})

describe('desktop connection probe', () => {
  test('verifies server identity, protocol, and auth header', async () => {
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'x-ai-ide-token': 'remote-token' })
      return new Response(JSON.stringify({ product: 'ai-ide-studio', protocolVersion: '1' }))
    }

    await expect(probeDesktopConnection(
      'https://ide.example.com',
      'remote-token',
      fetchImpl as typeof fetch,
    )).resolves.toEqual({ origin: 'https://ide.example.com', protocolVersion: '1' })
  })

  test('reports invalid credentials without accepting a public health response', async () => {
    const fetchImpl = async () => new Response('{}', { status: 401 })
    await expect(probeDesktopConnection(
      'https://ide.example.com',
      'bad-token',
      fetchImpl as typeof fetch,
    )).rejects.toThrow('访问密钥无效')
  })
})
