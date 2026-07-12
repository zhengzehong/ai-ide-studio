import { describe, it, expect, beforeEach, vi } from 'vitest'

// 这个测试验证移动端 PublishTemplateSheet 的核心交互逻辑的等价纯函数。
// 与 PC 端 PR4 publish modal 测试对应,移动端 sheet 同样要求 name 必填。

interface PublishState {
  name: string
  description: string
  submitting: boolean
  error: string | null
}

function makeInitialState(): PublishState {
  return { name: '', description: '', submitting: false, error: null }
}

function canSubmit(state: PublishState): boolean {
  return !!state.name.trim() && !state.submitting
}

// 复刻 handleSubmit 逻辑
async function submitPublish(
  state: PublishState,
  sessionId: string,
  publishFn: (sessionId: string, name: string, description?: string) => Promise<{ id: string }>,
  onPublished: () => void,
  onClose: () => void,
): Promise<{ state: PublishState; closed: boolean; published: boolean }> {
  if (!canSubmit(state)) {
    return { state, closed: false, published: false }
  }
  let next: PublishState = { ...state, submitting: true, error: null }
  try {
    await publishFn(sessionId, state.name.trim(), state.description.trim() || undefined)
    onPublished()
    onClose()
    return { state: { ...next, submitting: false }, closed: true, published: true }
  } catch (err) {
    next = {
      ...next,
      submitting: false,
      error: err instanceof Error ? err.message : '发布模板失败',
    }
    return { state: next, closed: false, published: false }
  }
}

describe('Mobile PublishTemplateSheet 行为逻辑测试', () => {
  let state: PublishState

  beforeEach(() => {
    state = makeInitialState()
  })

  it('名称空:canSubmit=false', () => {
    expect(canSubmit(state)).toBe(false)
  })

  it('名称非空:canSubmit=true', () => {
    state.name = '代码审查工作流'
    expect(canSubmit(state)).toBe(true)
  })

  it('仅空格:canSubmit=false', () => {
    state.name = '   '
    expect(canSubmit(state)).toBe(false)
  })

  it('submitting 时:canSubmit=false', () => {
    state.name = 'x'
    state.submitting = true
    expect(canSubmit(state)).toBe(false)
  })

  it('发布成功:publishSessionTemplate 被调用,onPublished + onClose', async () => {
    state.name = '代码审查'
    state.description = '描述'
    const publishFn = vi.fn().mockResolvedValue({ id: 'tpl-new-m-1' })
    const onPublished = vi.fn()
    const onClose = vi.fn()
    const result = await submitPublish(state, 'sess-src-m-1', publishFn, onPublished, onClose)
    expect(publishFn).toHaveBeenCalledWith('sess-src-m-1', '代码审查', '描述')
    expect(onPublished).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    expect(result.published).toBe(true)
    expect(result.closed).toBe(true)
    expect(result.state.submitting).toBe(false)
    expect(result.state.error).toBeNull()
  })

  it('description 空 → 传 undefined', async () => {
    state.name = '空描述模板'
    state.description = ''
    const publishFn = vi.fn().mockResolvedValue({ id: 'tpl-new-m-2' })
    const onPublished = vi.fn()
    const onClose = vi.fn()
    await submitPublish(state, 'sess-src-m-2', publishFn, onPublished, onClose)
    expect(publishFn).toHaveBeenCalledWith('sess-src-m-2', '空描述模板', undefined)
  })

  it('description 仅空格 → 传 undefined', async () => {
    state.name = '空白描述'
    state.description = '   '
    const publishFn = vi.fn().mockResolvedValue({ id: 'tpl-new-m-3' })
    await submitPublish(state, 'sess-src-m-3', publishFn, vi.fn(), vi.fn())
    expect(publishFn).toHaveBeenCalledWith('sess-src-m-3', '空白描述', undefined)
  })

  it('发布失败:error 设置,不触发 onPublished/onClose', async () => {
    state.name = '失败模板'
    const publishFn = vi.fn().mockRejectedValue(new Error('fork failed'))
    const onPublished = vi.fn()
    const onClose = vi.fn()
    const result = await submitPublish(state, 'sess-src-m-4', publishFn, onPublished, onClose)
    expect(publishFn).toHaveBeenCalled()
    expect(onPublished).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(result.published).toBe(false)
    expect(result.closed).toBe(false)
    expect(result.state.error).toBe('fork failed')
    expect(result.state.submitting).toBe(false)
  })

  it('名称空时点击发布:不调用 publishFn', async () => {
    state.name = ''
    const publishFn = vi.fn()
    const result = await submitPublish(state, 'sess-src-m-5', publishFn, vi.fn(), vi.fn())
    expect(publishFn).not.toHaveBeenCalled()
    expect(result.published).toBe(false)
  })
})
