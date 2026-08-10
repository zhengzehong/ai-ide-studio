import { afterEach, describe, expect, test } from 'vitest'
import {
  configureFileAssetSigning,
  createFileAssetUrl,
  verifyFileAssetSignature,
} from '../../src/gateway/file-asset-signing.js'

const input = {
  projectId: 'project-1',
  path: 'D:/shared/demo.mp4',
  mode: 'inline' as const,
}

afterEach(() => configureFileAssetSigning())

describe('file asset signing', () => {
  test('accepts an intact ticket and rejects path tampering', () => {
    configureFileAssetSigning('local-secret')
    const ticket = createFileAssetUrl(input, { now: 1_000, ttlMs: 60_000 })

    expect(verifyFileAssetSignature({
      ...input,
      expiresAt: ticket.expiresAt,
      signature: ticket.signature,
    }, 2_000)).toBe('valid')
    expect(verifyFileAssetSignature({
      ...input,
      path: 'D:/shared/other.mp4',
      expiresAt: ticket.expiresAt,
      signature: ticket.signature,
    }, 2_000)).toBe('invalid')
  })

  test('rejects an expired ticket without invalidating the underlying path', () => {
    configureFileAssetSigning('local-secret')
    const ticket = createFileAssetUrl(input, { now: 1_000, ttlMs: 1_000 })

    expect(verifyFileAssetSignature({
      ...input,
      expiresAt: ticket.expiresAt,
      signature: ticket.signature,
    }, 2_001)).toBe('expired')
    expect(ticket.url).not.toContain('local-secret')
    expect(ticket.url).toContain('/api/fs/asset?')
  })
})
