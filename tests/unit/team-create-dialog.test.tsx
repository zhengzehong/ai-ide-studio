import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { CreateTeamDialog } from '../../ui/src/components/team/CreateTeamDialog'

describe('CreateTeamDialog', () => {
  test('renders team metadata and an editable Master prompt field', () => {
    const html = renderToStaticMarkup(createElement(CreateTeamDialog, {
      open: true,
      projectId: 'project-a',
      onClose: vi.fn(),
      onCreated: vi.fn(),
    }))

    expect(html).toContain('创建智能体团队')
    expect(html).toContain('团队名称')
    expect(html).toContain('团队描述')
    expect(html).toContain('Master 提示词')
    expect(html).toContain('创建团队')
  })

  test('does not render when closed', () => {
    const html = renderToStaticMarkup(createElement(CreateTeamDialog, {
      open: false,
      projectId: 'project-a',
      onClose: vi.fn(),
      onCreated: vi.fn(),
    }))
    expect(html).toBe('')
  })
})
