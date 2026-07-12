import { describe, it, expect, beforeEach, vi } from 'vitest'

// 这个测试验证 PublishTemplateModal 的核心交互逻辑的等价纯函数。
// 项目没装 @testing-library/react,我们复刻组件里的关键状态转移:
// 1) 名称空 → canSubmit=false
// 2) 点击发布 → publishSessionTemplate → onPublished + onClose
// 3) publish 失败 → setError,不触发 onClose

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

describe('PublishTemplateModal 行为逻辑测试', () => {
  let state: PublishState

  beforeEach(() => {
    state = makeInitialState()
  })

  it('名称空:canSubmit=false', () => {
    expect(canSubmit(state)).toBe(false)
  })

  it('仅空格:canSubmit=false', () => {
    state.name = '   '
    expect(canSubmit(state)).toBe(false)
  })

  it('名称有内容:canSubmit=true', () => {
    state.name = '代码审查工作流'
    expect(canSubmit(state)).toBe(true)
  })

  it('submitting 时:canSubmit=false', () => {
    state.name = 'x'
    state.submitting = true
    expect(canSubmit(state)).toBe(false)
  })

  it('点击发布成功:publishSessionTemplate 被调用,onPublished + onClose', async () => {
    state.name = '代码审查'
    state.description = '描述'
    const publishFn = vi.fn().mockResolvedValue({ id: 'tpl-new-1' })
    const onPublished = vi.fn()
    const onClose = vi.fn()
    const result = await submitPublish(state, 'sess-src-1', publishFn, onPublished, onClose)
    expect(publishFn).toHaveBeenCalledWith('sess-src-1', '代码审查', '描述')
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
    const publishFn = vi.fn().mockResolvedValue({ id: 'tpl-new-2' })
    const onPublished = vi.fn()
    const onClose = vi.fn()
    await submitPublish(state, 'sess-src-2', publishFn, onPublished, onClose)
    expect(publishFn).toHaveBeenCalledWith('sess-src-2', '空描述模板', undefined)
  })

  it('description 仅空格 → 传 undefined', async () => {
    state.name = '空白描述'
    state.description = '   '
    const publishFn = vi.fn().mockResolvedValue({ id: 'tpl-new-3' })
    await submitPublish(state, 'sess-src-3', publishFn, vi.fn(), vi.fn())
    expect(publishFn).toHaveBeenCalledWith('sess-src-3', '空白描述', undefined)
  })

  it('发布失败:error 设置,不触发 onPublished/onClose', async () => {
    state.name = '失败模板'
    const publishFn = vi.fn().mockRejectedValue(new Error('fork failed'))
    const onPublished = vi.fn()
    const onClose = vi.fn()
    const result = await submitPublish(state, 'sess-src-4', publishFn, onPublished, onClose)
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
    const result = await submitPublish(state, 'sess-src-5', publishFn, vi.fn(), vi.fn())
    expect(publishFn).not.toHaveBeenCalled()
    expect(result.published).toBe(false)
  })
})
