import { Pin } from 'lucide-react'

interface WidgetPinButtonProps {
  pinned: boolean
  onToggle(): void
}

export function WidgetPinButton({ pinned, onToggle }: WidgetPinButtonProps) {
  const label = pinned ? '取消置顶' : '置顶组件'

  return (
    <button
      className={`widget-icon-button${pinned ? ' widget-icon-button--active' : ''}`}
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
    >
      <Pin size={14} fill={pinned ? 'currentColor' : 'none'} />
    </button>
  )
}

