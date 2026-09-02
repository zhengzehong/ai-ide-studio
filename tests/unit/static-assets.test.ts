import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheControlForAssetPath, mountStaticAssets, shouldUseSpaFallback } from '../../src/gateway/static-assets.js'

describe('static asset cache policy', () => {
  it('long-caches only fingerprinted build assets', () => {
    expect(cacheControlForAssetPath('/assets/index-Cw_JqY9r.js'))
      .toBe('public, max-age=31536000, immutable')
    expect(cacheControlForAssetPath('/app/assets/vendor-12345678.css'))
      .toBe('public, max-age=31536000, immutable')
    expect(cacheControlForAssetPath('/assets/font-a1B2_c3D.woff2'))
      .toBe('public, max-age=31536000, immutable')
  })

  it('forces HTML, SPA fallbacks, and unhashed files to revalidate', () => {
    expect(cacheControlForAssetPath('/index.html')).toBe('no-cache')
    expect(cacheControlForAssetPath('/p/project-1/workspace')).toBe('no-cache')
    expect(cacheControlForAssetPath('/assets/index.js')).toBe('no-cache')
    expect(cacheControlForAssetPath('/favicon.svg')).toBe('no-cache')
  })

  it('does not use the SPA fallback for missing asset files', () => {
    expect(shouldUseSpaFallback('/assets/missing-route.js')).toBe(false)
    expect(shouldUseSpaFallback('/app/assets/missing-route.js')).toBe(false)
    expect(shouldUseSpaFallback('/favicon.svg')).toBe(false)
    expect(shouldUseSpaFallback('/p/project-1/workspace')).toBe(true)
  })

  it('returns 404 for missing chunks while preserving SPA route fallback', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-ide-static-assets-'))
    try {
      writeFileSync(join(directory, 'index.html'), '<!doctype html><div id="root"></div>')
      const app = new Hono()
      mountStaticAssets(app, { host: '127.0.0.1', port: 0, dataDir: directory, runtime: 'web', staticDir: directory })

      const missingAsset = await app.request('/assets/old-page.js')
      const spaRoute = await app.request('/p/project-1/workspace')

      expect(missingAsset.status).toBe(404)
      expect(spaRoute.status).toBe(200)
      expect(await spaRoute.text()).toContain('id="root"')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
