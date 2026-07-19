import { describe, expect, it } from 'vitest'
import { cacheControlForAssetPath } from '../../src/gateway/static-assets.js'

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
})
