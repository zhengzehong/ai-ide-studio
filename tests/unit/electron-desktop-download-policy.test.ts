import { describe, expect, test } from 'vitest'
import { resolveAndValidateDownloadUrl, sanitizeDownloadFilename } from '../../electron/desktop-download-policy.js'

const signed = '/api/fs/asset?projectId=p1&path=docs%2Freport.md&mode=attachment&expires=9999999999999&signature=signed'

describe('desktop download policy', () => {
  test('accepts same-origin signed attachment URLs, including relative URLs', () => {
    expect(resolveAndValidateDownloadUrl(signed, 'https://ide.example.com').origin).toBe('https://ide.example.com')
    expect(resolveAndValidateDownloadUrl(`https://ide.example.com${signed}`, 'https://ide.example.com').pathname).toBe('/api/fs/asset')
  })

  test('rejects external, non-attachment, and unsigned URLs', () => {
    expect(() => resolveAndValidateDownloadUrl('https://evil.example/a', 'https://ide.example.com')).toThrow()
    expect(() => resolveAndValidateDownloadUrl(signed.replace('attachment', 'inline'), 'https://ide.example.com')).toThrow()
    expect(() => resolveAndValidateDownloadUrl('/api/fs/asset?projectId=p1&path=a', 'https://ide.example.com')).toThrow()
  })

  test('sanitizes save dialog filenames', () => {
    expect(sanitizeDownloadFilename('../report?.md')).toBe('.._report_.md')
    expect(sanitizeDownloadFilename('')).toBe('download')
  })
})
