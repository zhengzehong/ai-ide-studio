import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export type DesktopConnectionMode = 'managed-local' | 'remote'

export interface DesktopConnectionProfile {
  mode: DesktopConnectionMode
  remoteOrigin?: string
  token?: string
  widgetEnabled: boolean
}

export interface DesktopConnectionSettings {
  mode: DesktopConnectionMode
  remoteOrigin: string
  widgetEnabled: boolean
  hasStoredToken: boolean
}

export interface DesktopConnectionInput {
  mode: DesktopConnectionMode
  remoteOrigin?: string
  token?: string
  widgetEnabled: boolean
}

export interface CredentialProtector {
  protect(value: string): string
  unprotect(value: string): string
}

interface StoredDesktopConnection {
  version: 1
  mode: DesktopConnectionMode
  remoteOrigin?: string
  protectedToken?: string
  widgetEnabled: boolean
}

export class DesktopConnectionStore {
  constructor(
    private readonly filePath: string,
    private readonly credentials: CredentialProtector,
  ) {}

  load(): DesktopConnectionProfile | null {
    if (!existsSync(this.filePath)) return null
    try {
      const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      return parseStoredConnection(value, this.credentials)
    } catch {
      return null
    }
  }

  save(input: DesktopConnectionInput): DesktopConnectionProfile {
    const current = this.load()
    const profile = normalizeConnectionInput(input, current?.token)
    const stored: StoredDesktopConnection = {
      version: 1,
      mode: profile.mode,
      remoteOrigin: profile.remoteOrigin,
      protectedToken: profile.token ? this.credentials.protect(profile.token) : undefined,
      widgetEnabled: profile.widgetEnabled,
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(stored, null, 2), 'utf8')
    renameSync(temporaryPath, this.filePath)
    return profile
  }
}

export function normalizeConnectionInput(
  input: DesktopConnectionInput,
  currentToken?: string,
): DesktopConnectionProfile {
  if (input.mode === 'managed-local') {
    return { mode: 'managed-local', widgetEnabled: input.widgetEnabled }
  }
  const remoteOrigin = normalizeRemoteOrigin(input.remoteOrigin ?? '')
  const token = input.token?.trim() || currentToken?.trim()
  if (!token) throw new Error('请输入远程服务器访问密钥')
  return { mode: 'remote', remoteOrigin, token, widgetEnabled: input.widgetEnabled }
}

export function normalizeRemoteOrigin(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('请输入有效的服务器地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务器地址必须使用 HTTP 或 HTTPS')
  }
  if (parsed.username || parsed.password) throw new Error('服务器地址不能包含账号或密码')
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('服务器地址只能填写 origin，例如 https://ide.example.com')
  }
  return parsed.origin
}

export function toConnectionSettings(profile: DesktopConnectionProfile): DesktopConnectionSettings {
  return {
    mode: profile.mode,
    remoteOrigin: profile.remoteOrigin ?? '',
    widgetEnabled: profile.widgetEnabled,
    hasStoredToken: Boolean(profile.token),
  }
}

function parseStoredConnection(
  value: unknown,
  credentials: CredentialProtector,
): DesktopConnectionProfile | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (value.mode !== 'managed-local' && value.mode !== 'remote') return null
  if (typeof value.widgetEnabled !== 'boolean') return null
  if (value.mode === 'managed-local') {
    return { mode: 'managed-local', widgetEnabled: value.widgetEnabled }
  }
  if (typeof value.remoteOrigin !== 'string' || typeof value.protectedToken !== 'string') return null
  try {
    return {
      mode: 'remote',
      remoteOrigin: normalizeRemoteOrigin(value.remoteOrigin),
      token: credentials.unprotect(value.protectedToken),
      widgetEnabled: value.widgetEnabled,
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
