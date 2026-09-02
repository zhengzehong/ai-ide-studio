import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('../../ui/src/App.tsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../../ui/src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../../ui/src/main.tsx', import.meta.url), 'utf8')
const recoverySource = readFileSync(new URL('../../ui/src/routes/lazy-with-recovery.ts', import.meta.url), 'utf8')

describe('EXE menu blank-screen recovery', () => {
  it('keeps the application shell outside the route loading boundary', () => {
    expect(layoutSource).toContain('<RouteBoundary><Outlet /></RouteBoundary>')
    expect(appSource).not.toContain('<Suspense fallback={<RouteLoading />}>' + '\n' + '      {shouldShowAccessTokenPage')
  })

  it('provides an explicit reload path for failed lazy chunks', () => {
    expect(recoverySource).toContain('createChunkRecoveryPolicy')
    expect(recoverySource).toContain('重新加载')
    expect(recoverySource).toContain('window.location.reload()')
  })

  it('renders a startup error instead of leaving the Electron root empty', () => {
    expect(mainSource).toContain('startUi().catch')
    expect(mainSource).toContain('renderStartupError')
  })
})
