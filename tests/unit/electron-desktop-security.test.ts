import { describe, expect, test } from 'vitest'
import { isAllowedDesktopNavigation } from '../../electron/desktop-target.js'

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
})
