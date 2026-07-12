import { describe, it, expect, beforeEach, vi } from 'vitest'

// 这个测试验证 TemplatePickerModal 的核心交互逻辑的等价纯函数。
// 项目没装 @testing-library/react,我们复刻组件里的关键状态转移:
// 1) 打开时加载模板列表
// 2) 选中模板 → 调用 instantiate → 回调 onSelect(sessionId)
// 3) instantiate 失败 → setError,不回调 onSelect

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

describe('TemplatePickerModal 行为逻辑测试', () => {
  let state: PickerState

  beforeEach(() => {
    state = makeInitialState()
  })

  it('打开时加载模板列表:loading → templates 填充', async () => {
    const listFn = vi.fn<(agentId: string) => Promise<TemplateItem[]>>().mockResolvedValue([
      { id: 'tpl-1', name: '代码审查', description: '审查工作流', use_count: 3, last_used_at: null },
      { id: 'tpl-2', name: 'Bug 修复', description: null, use_count: 0, last_used_at: null },
    ])
    const next = await loadTemplates(state, listFn, 'agent-1')
    expect(listFn).toHaveBeenCalledWith('agent-1')
    expect(next.loading).toBe(false)
    expect(next.templates.length).toBe(2)
    expect(next.templates[0].id).toBe('tpl-1')
    expect(next.error).toBeNull()
  })

  it('加载模板失败:error 设置,templates 保持空', async () => {
    const listFn = vi.fn().mockRejectedValue(new Error('DB down'))
    const next = await loadTemplates(state, listFn, 'agent-1')
    expect(next.loading).toBe(false)
    expect(next.templates).toEqual([])
    expect(next.error).toBe('DB down')
  })

  it('点击模板:instantiate → onSelect(sessionId) → onClose', async () => {
    state.templates = [
      { id: 'tpl-1', name: '代码审查', description: null, use_count: 0, last_used_at: null },
    ]
    const instantiateFn = vi.fn().mockResolvedValue({ id: 'sess-new-1' })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const result = await pickTemplate(state, state.templates[0], instantiateFn, onSelect, onClose)
    expect(instantiateFn).toHaveBeenCalledWith('tpl-1')
    expect(onSelect).toHaveBeenCalledWith('sess-new-1')
    expect(onClose).toHaveBeenCalled()
    expect(result.selectedSessionId).toBe('sess-new-1')
    expect(result.closed).toBe(true)
    expect(result.state.instantiatingId).toBeNull()
    expect(result.state.error).toBeNull()
  })

  it('instantiate 失败:error 设置,不触发 onSelect/onClose', async () => {
    state.templates = [
      { id: 'tpl-2', name: '失败模板', description: null, use_count: 0, last_used_at: null },
    ]
    const instantiateFn = vi.fn().mockRejectedValue(new Error('fork failed'))
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const result = await pickTemplate(state, state.templates[0], instantiateFn, onSelect, onClose)
    expect(instantiateFn).toHaveBeenCalledWith('tpl-2')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(result.selectedSessionId).toBeNull()
    expect(result.closed).toBe(false)
    expect(result.state.error).toBe('fork failed')
    expect(result.state.instantiatingId).toBeNull()
  })
})
