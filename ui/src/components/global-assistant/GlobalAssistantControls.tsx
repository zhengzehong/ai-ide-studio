import type { CSSProperties, ReactNode } from 'react'
import { Check, Circle, Loader2 } from 'lucide-react'
import type { ConfigOptionInfo, ImageAttachmentInfo } from '../../stores/session-events'
import { configOptionLabel } from '../../pages/workspace/helpers'

export function CompactPlanBar({ plan }: { plan: { content: string; status: string }[] }) {
  return (
    <div className="global-assistant-plan">
      {plan.map((item) => (
        <span key={item.content} className={item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'active' : ''}>
          {item.status === 'completed' ? <Check size={11} /> : item.status === 'in_progress' ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Circle size={11} />}
          {item.content}
        </span>
      ))}
    </div>
  )
}

export function Dropdown({ children, onClose, style }: { children: ReactNode; onClose: () => void; style: CSSProperties }) {
  return (
    <>
      <div className="global-assistant-menu-backdrop" onClick={onClose} />
      <div className="global-assistant-menu" style={style}>{children}</div>
    </>
  )
}

export function MenuOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`global-assistant-menu-option${active ? ' active' : ''}`} onClick={onClick}>
      {active ? <Check size={13} /> : <Circle size={13} />}{label}
    </button>
  )
}

export function ConfigMenuOptions({
  configId,
  options,
  setConfig,
  onClose,
}: {
  configId: string
  options: ConfigOptionInfo[]
  setConfig: (configId: string, value: string | boolean) => Promise<void>
  onClose: () => void
}) {
  const option = options.find((item) => item.id === configId)
  if (!option) return null
  if (option.type === 'boolean') {
    return <MenuOption active={option.currentValue === true} label={option.name} onClick={() => { void setConfig(option.id, option.currentValue !== true); onClose() }} />
  }
  return option.options?.map((item) => (
    <MenuOption
      key={item.value}
      active={item.value === option.currentValue}
      label={configOptionLabel(item.value, item.name)}
      onClick={() => { void setConfig(option.id, item.value); onClose() }}
    />
  ))
}

export function AttachmentList({ attachments }: { attachments: ImageAttachmentInfo[] }) {
  return (
    <div className="global-assistant-attachments">
      {attachments.map((image, index) => (
        <img key={`${image.name || image.mimeType}-${index}`} src={`data:${image.mimeType};base64,${image.data}`} alt={image.name || '附件'} />
      ))}
    </div>
  )
}
