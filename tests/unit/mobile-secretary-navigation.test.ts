import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { resolveAndroidBackAction } from '../../mobile/src/components/AndroidBackHandler'

describe('mobile secretary navigation', () => {
  test('returns from mail detail to the secretary inbox before leaving the tab', () => {
    expect(resolveAndroidBackAction('/secretary/secretary-1/thread-1', 'http://localhost'))
      .toEqual({ type: 'navigate', to: '/secretary' })
    expect(resolveAndroidBackAction('/secretary', 'http://localhost'))
      .toEqual({ type: 'navigate', to: '/' })
  })

  test('registers a route-backed mail detail and keeps the secretary tab active', () => {
    const app = readFileSync(resolve('mobile/src/App.tsx'), 'utf8')
    const shell = readFileSync(resolve('mobile/src/components/MobileShell.tsx'), 'utf8')
    const page = readFileSync(resolve('mobile/src/pages/SecretaryPage.tsx'), 'utf8')
    expect(app).toContain('/secretary/:secretaryId/:threadId')
    expect(shell).toContain("location.pathname.startsWith('/secretary')")
    expect(page).toContain('threadId ? store.threads.find')
    expect(page).not.toContain('?? store.threads[0]')
  })
})
