import { safeStorage } from 'electron'
import type { CredentialProtector } from './desktop-connection.js'

export function createDesktopCredentialProtector(): CredentialProtector {
  return {
    protect(value: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统无法安全保存远程访问密钥')
      }
      return safeStorage.encryptString(value).toString('base64')
    },
    unprotect(value: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统无法读取已保存的远程访问密钥')
      }
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    },
  }
}
