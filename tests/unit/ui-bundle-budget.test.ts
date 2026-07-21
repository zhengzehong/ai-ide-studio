import { describe, expect, it } from 'vitest'
import { assessBundleManifest } from '../../scripts/check-ui-bundle.mjs'

describe('UI bundle budget', () => {
  it('accepts a bounded entry with route-level dynamic chunks', () => {
    const manifest = manifestWithRoutes(18)
    expect(assessBundleManifest(manifest, {
      'assets/index-hash.js': 405 * 1024,
    })).toEqual({ entryBytes: 405 * 1024, dynamicRouteCount: 18 })
  })

  it('rejects oversized entries and missing route chunks', () => {
    expect(() => assessBundleManifest(manifestWithRoutes(18), {
      'assets/index-hash.js': 451 * 1024,
    })).toThrow('入口 chunk 超过预算')

    expect(() => assessBundleManifest(manifestWithRoutes(2), {
      'assets/index-hash.js': 100 * 1024,
    })).toThrow('动态页面 chunk 数量不足')
  })
})

function manifestWithRoutes(count: number): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    'index.html': { file: 'assets/index-hash.js', src: 'index.html', isEntry: true },
  }
  for (let index = 0; index < count; index += 1) {
    manifest[`src/pages/Page${index}.tsx`] = {
      file: `assets/Page${index}-hash.js`,
      isDynamicEntry: true,
    }
  }
  return manifest
}
