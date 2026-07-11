import { describe, expect, test } from 'vitest'
import { parsePreviewPublishOutput } from '../../ui/src/pages/workspace/helpers'

const VALID = {
  previewId: 'prev-001',
  url: 'http://127.0.0.1:3000/preview/prev-001/?token=abc',
  title: '原型 A',
  target: 'pc',
  taskId: 'task-001',
  createdAt: '2026-07-11T03:00:00.000Z',
}

describe('parsePreviewPublishOutput', () => {
  test('解析 MCP 标准 content 数组形态(主路径)', () => {
    const raw = [{ type: 'text', text: JSON.stringify(VALID) }]
    const got = parsePreviewPublishOutput(raw)
    expect(got).toEqual(VALID)
  })

  test('解析 JSON 字符串形态', () => {
    const got = parsePreviewPublishOutput(JSON.stringify(VALID))
    expect(got).toEqual(VALID)
  })

  test('解析直接对象形态', () => {
    const got = parsePreviewPublishOutput(VALID)
    expect(got).toEqual(VALID)
  })

  test('对象缺 url 时回退到默认路径', () => {
    const { url: _omit, ...noUrl } = VALID
    void _omit
    const got = parsePreviewPublishOutput(noUrl)
    expect(got?.url).toBe('/preview/prev-001/')
  })

  test('target=app 时正确识别', () => {
    const got = parsePreviewPublishOutput({ ...VALID, target: 'app' })
    expect(got?.target).toBe('app')
  })

  test('数组含多个 text 元素时取第一个有效 JSON', () => {
    const raw = [
      { type: 'text', text: 'not json' },
      { type: 'text', text: JSON.stringify(VALID) },
    ]
    const got = parsePreviewPublishOutput(raw)
    expect(got?.previewId).toBe('prev-001')
  })

  test('空数组返回 null', () => {
    expect(parsePreviewPublishOutput([])).toBeNull()
  })

  test('数组里 text 不是合法 JSON 返回 null', () => {
    const raw = [{ type: 'text', text: 'not json' }]
    expect(parsePreviewPublishOutput(raw)).toBeNull()
  })

  test('对象带 error 字段返回 null(工具失败时)', () => {
    const raw = [{ type: 'text', text: JSON.stringify({ error: 'sourcePath 不存在' }) }]
    expect(parsePreviewPublishOutput(raw)).toBeNull()
  })

  test('非 preview 对象(缺 previewId)返回 null', () => {
    const raw = [{ type: 'text', text: JSON.stringify({ foo: 'bar' }) }]
    expect(parsePreviewPublishOutput(raw)).toBeNull()
  })

  test('null/undefined 返回 null', () => {
    expect(parsePreviewPublishOutput(null)).toBeNull()
    expect(parsePreviewPublishOutput(undefined)).toBeNull()
  })

  test('缺关键字段(title)返回 null', () => {
    const { title: _t, ...noTitle } = VALID
    void _t
    expect(parsePreviewPublishOutput(noTitle)).toBeNull()
  })

  test('非法 target 值返回 null', () => {
    expect(parsePreviewPublishOutput({ ...VALID, target: 'desktop' })).toBeNull()
  })
})
