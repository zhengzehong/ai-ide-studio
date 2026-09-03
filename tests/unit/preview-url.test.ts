import { describe, expect, test } from 'vitest'
import { buildPreviewUrl } from '../../ui/src/services/preview-url.js'

describe('buildPreviewUrl', () => {
  test('appends the auth token so the first iframe load passes preview auth', () => {
    // 预览 cookie 是 per-previewId 的，首访必须带 token（与 preview.publish 工具输出同款）
    const url = buildPreviewUrl('preview-1', 'tok-abc')
    expect(url).toBe('/preview/preview-1/?token=tok-abc')
  })

  test('encodes special characters in the token', () => {
    const url = buildPreviewUrl('preview-1', 'a b&c')
    expect(url).toBe('/preview/preview-1/?token=a%20b%26c')
  })

  test('falls back to a bare URL when no token is available', () => {
    // node 测试环境无 window/localStorage → 无 token 可用
    const url = buildPreviewUrl('preview-2')
    expect(url).toBe('/preview/preview-2/')
  })

  test('ignores an empty override and still returns the bare URL', () => {
    expect(buildPreviewUrl('preview-3', '   ')).toBe('/preview/preview-3/')
  })
})
