import { describe, expect, test } from 'vitest'
import { isPreviewPublishTool } from '../../ui/src/pages/workspace/helpers'

describe('isPreviewPublishTool', () => {
  test('matches plain stdio gateway title', () => {
    expect(isPreviewPublishTool('preview.publish')).toBe(true)
  })

  test('matches ai-ide-tools HTTP MCP namespaced title', () => {
    expect(isPreviewPublishTool('mcp__ai-ide-tools__preview_publish')).toBe(true)
  })

  test('rejects other tool names with preview.publish suffix', () => {
    expect(isPreviewPublishTool('preview.publish.other')).toBe(false)
  })

  test('rejects other MCP namespaces with preview_publish', () => {
    expect(isPreviewPublishTool('mcp__other-server__preview_publish')).toBe(false)
  })

  test('rejects undefined', () => {
    expect(isPreviewPublishTool(undefined)).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isPreviewPublishTool('')).toBe(false)
  })

  test('rejects null', () => {
    expect(isPreviewPublishTool(null)).toBe(false)
  })
})
