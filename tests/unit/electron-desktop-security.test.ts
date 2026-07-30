import { describe, expect, test } from 'vitest'
import { isAllowedDesktopNavigation } from '../../electron/desktop-target.js'
import {
  isDesktopApplicationPath,
  isTrustedDesktopIpcSender,
  isWidgetPath,
} from '../../electron/desktop-ipc-policy.js'

describe('Electron desktop navigation policy', () => {
  test('allows paths on the active server origin', () => {
    expect(isAllowedDesktopNavigation(
      'https://ide.example.com/p/project/workspace',
      'https://ide.example.com',
    )).toBe(true)
  })

  test('rejects other origins and deceptive hostnames', () => {
    expect(isAllowedDesktopNavigation('https://docs.example.com', 'https://ide.example.com')).toBe(false)
    expect(isAllowedDesktopNavigation('https://ide.example.com.attacker.test', 'https://ide.example.com')).toBe(false)
  })

  test('rejects API and preview top-level navigation', () => {
    expect(isAllowedDesktopNavigation('https://ide.example.com/api/v1/tasks', 'https://ide.example.com')).toBe(false)
    expect(isAllowedDesktopNavigation('https://ide.example.com/preview/p1/', 'https://ide.example.com')).toBe(false)
  })
})

describe('Electron IPC sender policy', () => {
  test('requires an allowed main frame on an application route', () => {
    const base = {
      senderId: 7,
      allowedSenderIds: new Set([7]),
      isMainFrame: true,
      frameUrl: 'https://ide.example.com/settings',
      allowedOrigin: 'https://ide.example.com',
      allowedPath: isDesktopApplicationPath,
    }
    expect(isTrustedDesktopIpcSender(base)).toBe(true)
    expect(isTrustedDesktopIpcSender({ ...base, senderId: 8 })).toBe(false)
    expect(isTrustedDesktopIpcSender({ ...base, isMainFrame: false })).toBe(false)
    expect(isTrustedDesktopIpcSender({ ...base, frameUrl: 'https://evil.example/settings' })).toBe(false)
    expect(isTrustedDesktopIpcSender({ ...base, frameUrl: 'https://ide.example.com/preview/p1/' })).toBe(false)
  })

  test('limits the Widget bridge to the Widget route', () => {
    const base = {
      senderId: 9,
      allowedSenderIds: new Set([9]),
      isMainFrame: true,
      frameUrl: 'http://127.0.0.1:18800/widget',
      allowedOrigin: 'http://127.0.0.1:18800',
      allowedPath: isWidgetPath,
    }
    expect(isTrustedDesktopIpcSender(base)).toBe(true)
    expect(isTrustedDesktopIpcSender({ ...base, frameUrl: 'http://127.0.0.1:18800/settings' })).toBe(false)
  })
})
