import { describe, expect, test } from 'vitest'
import {
  deriveInspirationTitle,
  INSPIRATION_AUTO_TITLE_MAX_LENGTH,
  isLegacyInspirationTitle,
  resolveInspirationTitle,
} from '../../src/shared/inspiration-title.js'

describe('inspiration automatic title', () => {
  test('keeps the original wording instead of summarizing the first sentence', () => {
    expect(deriveInspirationTitle('4、AI发展到最后是什么，假设token不要钱的话，最后的形式')).toBe(
      '4、AI发展到最后是什么，假设token不要钱的话，最后的形式',
    )
  })

  test('normalizes Markdown whitespace and truncates by Unicode characters', () => {
    const source = `# ${'灵感😀'.repeat(30)}\n\n后续信息`
    const title = deriveInspirationTitle(source)

    expect(Array.from(title)).toHaveLength(INSPIRATION_AUTO_TITLE_MAX_LENGTH)
    expect(title.endsWith('…')).toBe(true)
    expect(title.startsWith('灵感😀')).toBe(true)
  })

  test('recognizes only the old generated date title', () => {
    expect(isLegacyInspirationTitle('8月25日 灵感')).toBe(true)
    expect(isLegacyInspirationTitle('AI发展到最后是什么')).toBe(false)
  })

  test('keeps manual titles and regenerates automatic titles from edited content', () => {
    expect(resolveInspirationTitle({
      title: '人工标题',
      titleMode: 'manual',
      sourceMarkdown: '新的正文内容',
    })).toEqual({ title: '人工标题', titleMode: 'manual' })
    expect(resolveInspirationTitle({
      title: '旧自动标题',
      titleMode: 'auto',
      sourceMarkdown: '新的正文内容保留全部信息',
    })).toEqual({ title: '新的正文内容保留全部信息', titleMode: 'auto' })
  })
})
