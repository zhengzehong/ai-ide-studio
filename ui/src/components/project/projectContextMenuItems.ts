export interface ProjectContextMenuItem {
  label: string
  danger?: boolean
  dividerAfter?: boolean
  onClick: () => void
}

export function buildProjectContextMenuItems(opts: {
  isPinned: boolean
  onTogglePin: () => void
  onCopyPath: () => void
  onEdit: () => void
  onDelete: () => void
}): ProjectContextMenuItem[] {
  return [
    { label: opts.isPinned ? '取消固定' : '固定到 Tab 栏', onClick: opts.onTogglePin },
    { label: '复制路径', onClick: opts.onCopyPath, dividerAfter: true },
    { label: '编辑项目', onClick: opts.onEdit },
    { label: '删除项目', onClick: opts.onDelete, danger: true },
  ]
}
