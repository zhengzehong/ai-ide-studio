import { describe, expect, test } from 'vitest'
import { absoluteReadingUrl, readingWorkspacePath, resolveReadingAssetUrl } from '../../ui/src/services/reading-client'

describe('reading client helpers', () => {
  test('keeps PC reading URLs relative and makes APP URLs server-absolute', () => {
    expect(absoluteReadingUrl('/reading/read-1/?token=x')).toBe('/reading/read-1/?token=x')
    expect(absoluteReadingUrl('/reading/read-1/?token=x', 'https://studio.example.com/')).toBe(
      'https://studio.example.com/reading/read-1/?token=x',
    )
    expect(absoluteReadingUrl('https://docs.example.com/a', 'https://studio.example.com')).toBe('https://docs.example.com/a')
  })

  test('resolves Markdown relative assets inside the mounted reading directory', () => {
    expect(resolveReadingAssetUrl('./images/cover.png', 'https://studio.example.com/reading/read-1/?token=x')).toBe(
      'https://studio.example.com/reading/read-1/images/cover.png',
    )
    expect(resolveReadingAssetUrl('https://cdn.example.com/a.png', 'https://studio.example.com/reading/read-1/')).toBe(
      'https://cdn.example.com/a.png',
    )
  })

  test('builds the existing project Workspace route for the source Session', () => {
    expect(readingWorkspacePath('proj-a', 'sess-a')).toBe('/p/proj-a/workspace?sessionId=sess-a')
  })
})
