import { describe, it, expect, beforeEach, vi } from 'vitest'

// 这个测试验证移动端 TemplatePickerSheet 的核心交互逻辑的等价纯函数。
// 移动端项目同样未装 @testing-library/react-native,采用与 PC 端 PR4 一致的
// 纯函数等价模式(参考 tests/unit/guest-chat-page-behavior.test.ts)。

interface TemplateItem {
  id: string
  name: string
  description: string | null
  use_count: number
  last_used_at: string | null
}

interface PickerState {
  loading: boolean
  error: string | null
  templates: TemplateItem[]
  instantiatingId: string | null
}

function makeInitialState(): PickerState {
  return { loading: false, error: null, templates: [], instantiatingId: null }
}

// 复刻 useEffect 里的加载逻辑
async function loadTemplates(
  state: PickerState,
  listFn: (agentId: string) => Promise<TemplateItem[]>,
  agentId: string,
): Promise<PickerState> {
  const next: PickerState = { ...state, loading: true, error: null }
  try {
    const rows = await listFn(agentId)
    return { ...next, loading: false, templates: rows }
  } catch (err) {
    return {
      ...next,
      loading: false,
      error: err instanceof Error ? err.message : '加载模板失败',
    }
  }
}

// 复刻 handlePick 逻辑
async function pickTemplate(
  state: PickerState,
  template: TemplateItem,
  instantiateFn: (templateId: string) => Promise<{ id: string }>,
  onSelect: (sessionId: string) => void,
  onClose: () => void,
): Promise<{ state: PickerState; selectedSessionId: string | null; closed: boolean }> {
  let next: PickerState = { ...state, instantiatingId: template.id, error: null }
  try {
    const session = await instantiateFn(template.id)
    onSelect(session.id)
    onClose()
    return { state: { ...next, instantiatingId: null }, selectedSessionId: session.id, closed: true }
  } catch (err) {
    next = { ...next, instantiatingId: null, error: err instanceof Error ? err.message : '从模板新建失败' }
    return { state: next, selectedSessionId: null, closed: false }
  }
}

describe('Mobile TemplatePickerSheet 行为逻辑测试', () => {
  let state: PickerState

  beforeEach(() => {
    state = makeInitialState()
  })

  it('加载空列表:loading → templates 为空数组', async () => {
    const listFn = vi.fn<(agentId: string) => Promise<TemplateItem[]>>().mockResolvedValue([])
    const next = await loadTemplates(state, listFn, 'agent-m-1')
    expect(listFn).toHaveBeenCalledWith('agent-m-1')
    expect(next.loading).toBe(false)
    expect(next.templates).toEqual([])
    expect(next.error).toBeNull()
  })

  it('加载有模板:loading → templates 填充', async () => {
    const listFn = vi.fn().mockResolvedValue([
      { id: 'tpl-m-1', name: '代码审查', description: '审查工作流', use_count: 3, last_used_at: null },
      { id: 'tpl-m-2', name: 'Bug 修复', description: null, use_count: 0, last_used_at: null },
    ])
    const next = await loadTemplates(state, listFn, 'agent-m-1')
    expect(next.loading).toBe(false)
    expect(next.templates.length).toBe(2)
    expect(next.templates[0].id).toBe('tpl-m-1')
    expect(next.error).toBeNull()
  })

  it('加载模板失败:error 设置', async () => {
    const listFn = vi.fn().mockRejectedValue(new Error('network down'))
    const next = await loadTemplates(state, listFn, 'agent-m-1')
    expect(next.loading).toBe(false)
    expect(next.templates).toEqual([])
    expect(next.error).toBe('network down')
  })

  it('点击模板:instantiate → onSelect(sessionId) → onClose', async () => {
    state.templates = [
      { id: 'tpl-m-1', name: '代码审查', description: null, use_count: 0, last_used_at: null },
    ]
    const instantiateFn = vi.fn().mockResolvedValue({ id: 'sess-new-m-1' })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const result = await pickTemplate(state, state.templates[0], instantiateFn, onSelect, onClose)
    expect(instantiateFn).toHaveBeenCalledWith('tpl-m-1')
    expect(onSelect).toHaveBeenCalledWith('sess-new-m-1')
    expect(onClose).toHaveBeenCalled()
    expect(result.selectedSessionId).toBe('sess-new-m-1')
    expect(result.closed).toBe(true)
    expect(result.state.instantiatingId).toBeNull()
    expect(result.state.error).toBeNull()
  })

  it('instantiate 失败:error 设置,不触发 onSelect/onClose', async () => {
    state.templates = [
      { id: 'tpl-m-2', name: '失败模板', description: null, use_count: 0, last_used_at: null },
    ]
    const instantiateFn = vi.fn().mockRejectedValue(new Error('fork failed'))
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const result = await pickTemplate(state, state.templates[0], instantiateFn, onSelect, onClose)
    expect(instantiateFn).toHaveBeenCalledWith('tpl-m-2')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(result.selectedSessionId).toBeNull()
    expect(result.closed).toBe(false)
    expect(result.state.error).toBe('fork failed')
    expect(result.state.instantiatingId).toBeNull()
  })
})
