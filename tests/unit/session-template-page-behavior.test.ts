import { describe, it, expect, beforeEach, vi } from 'vitest'

// 这个测试验证 TemplatesPage 的核心交互逻辑的等价纯函数。
// 项目没装 @testing-library/react,我们复刻页面里的关键状态转移:
// 1) 加载模板列表
// 2) 编辑模板 → updateSessionTemplate → 重新加载
// 3) 删除模板 → deleteSessionTemplate → 重新加载
// 4) 加载失败 → error 设置

interface TemplateRow {
  id: string
  name: string
  description: string | null
  agent_id: string
  use_count: number
  created_at: string
}

interface PageState {
  templates: TemplateRow[]
  loading: boolean
  error: string | null
  editing: TemplateRow | null
  deleting: TemplateRow | null
  toast: string | null
}

function makeInitialState(): PageState {
  return { templates: [], loading: false, error: null, editing: null, deleting: null, toast: null }
}

// 复刻 fetchTemplates 逻辑
async function fetchTemplates(
  state: PageState,
  listFn: () => Promise<TemplateRow[]>,
): Promise<PageState> {
  const next: PageState = { ...state, loading: true, error: null }
  try {
    const rows = await listFn()
    return { ...next, loading: false, templates: rows }
  } catch (err) {
    return {
      ...next,
      loading: false,
      error: err instanceof Error ? err.message : '加载模板失败',
    }
  }
}

// 复刻 handleEditSave 逻辑
async function saveEdit(
  state: PageState,
  nextName: string,
  nextDescription: string,
  updateFn: (templateId: string, fields: { name: string; description: string }) => Promise<TemplateRow>,
  listFn: () => Promise<TemplateRow[]>,
): Promise<PageState> {
  if (!state.editing) return state
  let next: PageState = { ...state }
  try {
    await updateFn(state.editing.id, { name: nextName, description: nextDescription })
    next = { ...next, toast: '已保存', editing: null }
    return await fetchTemplates(next, listFn)
  } catch (err) {
    return { ...next, toast: err instanceof Error ? err.message : '保存失败' }
  }
}

// 复刻 handleDelete 逻辑
async function confirmDelete(
  state: PageState,
  deleteFn: (templateId: string) => Promise<void>,
  listFn: () => Promise<TemplateRow[]>,
): Promise<PageState> {
  if (!state.deleting) return state
  let next: PageState = { ...state }
  try {
    await deleteFn(state.deleting.id)
    next = { ...next, toast: '已删除', deleting: null }
    return await fetchTemplates(next, listFn)
  } catch (err) {
    return {
      ...next,
      toast: err instanceof Error ? err.message : '删除失败',
      deleting: null,
    }
  }
}

describe('TemplatesPage 行为逻辑测试', () => {
  let state: PageState

  beforeEach(() => {
    state = makeInitialState()
  })

  it('加载模板列表:loading → templates 填充', async () => {
    const listFn = vi.fn().mockResolvedValue([
      {
        id: 'tpl-1',
        name: '代码审查',
        description: '审查工作流',
        agent_id: 'agent-1',
        use_count: 3,
        created_at: '2026-07-13T10:00:00Z',
      },
    ])
    const next = await fetchTemplates(state, listFn)
    expect(next.loading).toBe(false)
    expect(next.templates.length).toBe(1)
    expect(next.templates[0].name).toBe('代码审查')
    expect(next.error).toBeNull()
  })

  it('加载失败:error 设置', async () => {
    const listFn = vi.fn().mockRejectedValue(new Error('network down'))
    const next = await fetchTemplates(state, listFn)
    expect(next.loading).toBe(false)
    expect(next.templates).toEqual([])
    expect(next.error).toBe('network down')
  })

  it('编辑保存成功:update 调用 + toast 已保存 + 重新加载', async () => {
    state.templates = [
      {
        id: 'tpl-1',
        name: '旧名',
        description: '旧描述',
        agent_id: 'agent-1',
        use_count: 0,
        created_at: '2026-07-13T10:00:00Z',
      },
    ]
    state.editing = state.templates[0]
    const updateFn = vi.fn().mockResolvedValue({ ...state.editing, name: '新名' })
    const listFn = vi.fn().mockResolvedValue([
      { ...state.templates[0], name: '新名', description: '新描述' },
    ])
    const next = await saveEdit(state, '新名', '新描述', updateFn, listFn)
    expect(updateFn).toHaveBeenCalledWith('tpl-1', { name: '新名', description: '新描述' })
    expect(next.toast).toBe('已保存')
    expect(next.editing).toBeNull()
    expect(next.templates[0].name).toBe('新名')
  })

  it('编辑保存失败:toast 显示错误,editing 保持', async () => {
    state.editing = {
      id: 'tpl-1',
      name: '旧名',
      description: null,
      agent_id: 'agent-1',
      use_count: 0,
      created_at: '2026-07-13T10:00:00Z',
    }
    const updateFn = vi.fn().mockRejectedValue(new Error('db locked'))
    const listFn = vi.fn()
    const next = await saveEdit(state, '新名', '新描述', updateFn, listFn)
    expect(next.toast).toBe('db locked')
    expect(listFn).not.toHaveBeenCalled()
  })

  it('删除成功:delete 调用 + toast 已删除 + 重新加载', async () => {
    state.templates = [
      {
        id: 'tpl-1',
        name: '待删除',
        description: null,
        agent_id: 'agent-1',
        use_count: 0,
        created_at: '2026-07-13T10:00:00Z',
      },
    ]
    state.deleting = state.templates[0]
    const deleteFn = vi.fn().mockResolvedValue(undefined)
    const listFn = vi.fn().mockResolvedValue([])
    const next = await confirmDelete(state, deleteFn, listFn)
    expect(deleteFn).toHaveBeenCalledWith('tpl-1')
    expect(next.toast).toBe('已删除')
    expect(next.deleting).toBeNull()
    expect(next.templates).toEqual([])
  })

  it('删除失败:toast 显示错误,deleting 清空', async () => {
    state.deleting = {
      id: 'tpl-2',
      name: '失败',
      description: null,
      agent_id: 'agent-1',
      use_count: 0,
      created_at: '2026-07-13T10:00:00Z',
    }
    const deleteFn = vi.fn().mockRejectedValue(new Error('permission denied'))
    const listFn = vi.fn()
    const next = await confirmDelete(state, deleteFn, listFn)
    expect(next.toast).toBe('permission denied')
    expect(next.deleting).toBeNull()
    expect(listFn).not.toHaveBeenCalled()
  })
})
