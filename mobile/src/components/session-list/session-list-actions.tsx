import { Archive, Edit3, Pin, PinOff, Sparkles, Trash2, XCircle } from 'lucide-react'
import type { MobileSessionItem } from '../../stores/session.store'
import type { ActionItem } from '../ActionSheet'

interface Options {
  session: MobileSessionItem | null
  pinned: boolean
  onTogglePinned: () => void
  onRename: () => void
  onPublishTemplate: () => void
  onArchive: () => void
  onClose: () => void
  onDelete: () => void
}

export function buildSessionActionItems(options: Options): ActionItem[] {
  if (!options.session) return []
  return [
    {
      key: 'pin',
      label: options.pinned ? '取消置顶' : '置顶会话',
      icon: options.pinned ? <PinOff size={18} color="var(--text-primary)" /> : <Pin size={18} color="var(--text-primary)" />,
      onClick: options.onTogglePinned,
    },
    { key: 'rename', label: '重命名', icon: <Edit3 size={18} color="var(--text-primary)" />, onClick: options.onRename },
    { key: 'publishTemplate', label: '发布为模板', icon: <Sparkles size={18} color="var(--text-primary)" />, onClick: options.onPublishTemplate },
    { key: 'archive', label: '归档', icon: <Archive size={18} color="var(--text-primary)" />, onClick: options.onArchive },
    { key: 'close', label: '关闭会话', icon: <XCircle size={18} color="var(--text-primary)" />, onClick: options.onClose },
    { key: 'delete', label: '删除会话', icon: <Trash2 size={18} color="var(--error)" />, danger: true, onClick: options.onDelete },
  ]
}
