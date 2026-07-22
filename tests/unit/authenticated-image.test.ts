import { describe, expect, test, vi } from 'vitest'
import { createAuthenticatedImageLoader } from '../../ui/src/services/authenticated-image.ts'

describe('authenticated image loader', () => {
  test('adds the access token header and reuses the cached Blob URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      new Blob(['image-bytes'], { type: 'image/png' }),
      { status: 200, headers: { 'Content-Type': 'image/png' } },
    ))
    const createObjectUrl = vi.fn(() => 'blob:history-image')
    const loader = createAuthenticatedImageLoader({
      fetchImpl,
      getAccessToken: () => 'local-secret',
      createObjectUrl,
      revokeObjectUrl: vi.fn(),
    })

    await expect(loader.load('/api/images/images/session/image.png')).resolves.toBe('blob:history-image')
    await expect(loader.load('/api/images/images/session/image.png')).resolves.toBe('blob:history-image')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('/api/images/images/session/image.png', {
      headers: { 'x-ai-ide-token': 'local-secret' },
    })
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
  })

  test('does not cache failed requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: '未授权' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ))
    const loader = createAuthenticatedImageLoader({
      fetchImpl,
      getAccessToken: () => 'invalid',
      createObjectUrl: vi.fn(),
      revokeObjectUrl: vi.fn(),
    })

    await expect(loader.load('/api/images/protected.png')).rejects.toThrow('图片加载失败（HTTP 401）')
    await expect(loader.load('/api/images/protected.png')).rejects.toThrow('图片加载失败（HTTP 401）')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  test('revokes cached Blob URLs when disposed', async () => {
    const revokeObjectUrl = vi.fn()
    const loader = createAuthenticatedImageLoader({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(['image']))),
      getAccessToken: () => '',
      createObjectUrl: () => 'blob:dispose-me',
      revokeObjectUrl,
    })
    await loader.load('/api/images/image.png')

    loader.dispose()

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:dispose-me')
  })
})
