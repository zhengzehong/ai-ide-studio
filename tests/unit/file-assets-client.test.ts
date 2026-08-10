import { describe, expect, test } from 'vitest'
import { isUnsafeAssetUrl, requestFileAssetUrl } from '../../ui/src/services/file-assets.ts'

describe('file asset client', () => {
  test('keeps external HTTPS media direct and rejects executable URLs', async () => {
    await expect(requestFileAssetUrl({
      projectId: 'project-1',
      filePath: 'https://cdn.example.com/demo.mp4',
    })).resolves.toMatchObject({ url: 'https://cdn.example.com/demo.mp4' })
    expect(isUnsafeAssetUrl('javascript:alert(1)')).toBe(true)
    await expect(requestFileAssetUrl({
      projectId: 'project-1',
      filePath: 'javascript:alert(1)',
    })).rejects.toThrow('资源地址无效')
  })
})
