import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { ArrowUp, Paperclip, Settings2, Square, Wrench, X } from 'lucide-react'
import type { SessionCapabilities, UsageInfo } from '../../stores/session-events'
import { configLabel, menuStyle, modeCn, type MenuAnchor, type MenuName } from '../../pages/workspace/helpers'
import { ConfigMenuOptions, Dropdown, MenuOption } from './GlobalAssistantControls'

type PendingImage = { data: string; mimeType: string; preview: string }

export function GlobalAssistantInput({
  connected,
  blocked,
  streaming,
  capabilities,
  usage,
  onSend,
  onCancel,
  onSetModel,
  onSetMode,
  onSetConfig,
}: {
  connected: boolean
  blocked: boolean
  streaming: boolean
  capabilities: SessionCapabilities
  usage: UsageInfo | null
  onSend: (content: string, images: { data: string; mimeType: string }[]) => void
  onCancel: () => void
  onSetModel: (modelId: string) => Promise<void>
  onSetMode: (modeId: string) => Promise<void>
  onSetConfig: (configId: string, value: string | boolean) => Promise<void>
}) {
  const [inputValue, setInputValue] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [draggingImages, setDraggingImages] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const [showMenu, setShowMenu] = useState<MenuName | 'command' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagePreviewsRef = useRef<string[]>([])
  const canSend = connected && !blocked && !streaming && (!!inputValue.trim() || pendingImages.length > 0)
  const secondaryConfigs = capabilities.configOptions.filter((item) => item.category !== 'model' && item.category !== 'mode' && item.id !== 'model' && item.id !== 'mode')
  const currentModeName = capabilities.modes.find((item) => item.modeId === capabilities.currentModeId)?.name || capabilities.currentModeId
  const currentModelName = capabilities.models.find((item) => item.modelId === capabilities.currentModelId)?.name || capabilities.currentModelId

  useEffect(() => {
    imagePreviewsRef.current = pendingImages.map((image) => image.preview)
  }, [pendingImages])

  useEffect(() => () => imagePreviewsRef.current.forEach((preview) => URL.revokeObjectURL(preview)), [])

  const addImageFiles = (files: File[]) => {
    files.filter((file) => file.type.startsWith('image/')).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        setPendingImages((current) => [...current, { data: String(reader.result).split(',')[1], mimeType: file.type, preview: URL.createObjectURL(file) }])
      }
      reader.readAsDataURL(file)
    })
  }

  const send = () => {
    if (!canSend) return
    onSend(inputValue, pendingImages.map(({ data, mimeType }) => ({ data, mimeType })))
    setInputValue('')
    setPendingImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.preview))
      return []
    })
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    })
  }

  const openMenu = (name: MenuName | 'command', event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuAnchor({ name: name as MenuName, left: rect.left, top: rect.top - 8, minWidth: rect.width })
    setShowMenu(showMenu === name ? null : name)
  }

  return (
    <>
      <div className="global-assistant-input-wrap">
        {pendingImages.length > 0 && (
          <div className="global-assistant-image-list">
            {pendingImages.map((image, index) => (
              <span key={image.preview} className="global-assistant-image-chip">
                <img src={image.preview} alt="" />
                <button type="button" onClick={() => removePendingImage(index, setPendingImages)}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div
          className={`global-assistant-input${draggingImages ? ' global-assistant-input--dragging' : ''}`}
          onDragOver={(event: DragEvent<HTMLDivElement>) => {
            if (Array.from(event.dataTransfer.items).some((item) => item.type.startsWith('image/'))) {
              event.preventDefault()
              setDraggingImages(true)
            }
          }}
          onDragLeave={(event: DragEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImages(false)
          }}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
            setDraggingImages(false)
            if (files.length === 0) return
            event.preventDefault()
            addImageFiles(files)
          }}
        >
          <textarea
            ref={textareaRef}
            value={inputValue}
            rows={2}
            disabled={!connected || blocked || streaming}
            placeholder={blocked ? '等待确认后继续...' : streaming ? '正在生成中...' : '输入消息，或直接粘贴图片'}
            onChange={(event) => resizeInput(event, setInputValue)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
              const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
              if (files.length === 0) return
              event.preventDefault()
              addImageFiles(files)
            }}
          />
          <div className="global-assistant-toolbar">
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event: ChangeEvent<HTMLInputElement>) => {
              if (event.target.files) addImageFiles(Array.from(event.target.files))
              event.target.value = ''
            }} />
            <button type="button" className="global-assistant-tool-btn" onClick={() => fileInputRef.current?.click()} title="添加图片">
              <Paperclip size={15} />
            </button>
            {capabilities.commands.length > 0 && <button type="button" className="global-assistant-tool-btn" onClick={(event) => openMenu('command', event)}><Wrench size={13} /> 命令</button>}
            {capabilities.modes.length > 0 && <button type="button" className="global-assistant-tool-btn" onClick={(event) => openMenu('mode', event)}><Settings2 size={13} /> {modeCn(currentModeName)}</button>}
            <span className="global-assistant-toolbar-spacer" />
            {secondaryConfigs.map((item) => <button key={item.id} type="button" className="global-assistant-tool-btn" onClick={(event) => openMenu(`config:${item.id}`, event)}>{configLabel(item)}</button>)}
            {usage && <span className="global-assistant-usage">{Math.round((usage.contextUsed / usage.contextSize) * 100)}%</span>}
            {capabilities.models.length > 0 && <button type="button" className="global-assistant-tool-btn" onClick={(event) => openMenu('model', event)}>{currentModelName || '模型'}</button>}
            {streaming ? (
              <button type="button" className="global-assistant-send-btn global-assistant-send-btn--stop" onClick={onCancel} title="停止生成">
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button type="button" className="global-assistant-send-btn" disabled={!canSend} onClick={send} title="发送">
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {showMenu && (
        <Dropdown onClose={() => setShowMenu(null)} style={menuStyle(menuAnchor, showMenu === 'command' ? 300 : 260)}>
          {showMenu === 'command' && capabilities.commands.map((command) => (
            <button key={command.name} type="button" className="global-assistant-menu-item" onClick={() => {
              setInputValue(`/${command.name} `)
              setShowMenu(null)
              textareaRef.current?.focus()
            }}>
              <strong>/{command.name}</strong>
              <small>{command.description || command.input?.hint || '插入命令'}</small>
            </button>
          ))}
          {showMenu === 'mode' && capabilities.modes.map((mode) => (
            <MenuOption key={mode.modeId} active={mode.modeId === capabilities.currentModeId} label={modeCn(mode.name)} onClick={() => { void onSetMode(mode.modeId); setShowMenu(null) }} />
          ))}
          {showMenu === 'model' && capabilities.models.map((model) => (
            <MenuOption key={model.modelId} active={model.modelId === capabilities.currentModelId} label={model.name || model.modelId} onClick={() => { void onSetModel(model.modelId); setShowMenu(null) }} />
          ))}
          {showMenu?.startsWith('config:') && (
            <ConfigMenuOptions
              configId={showMenu.slice(7)}
              options={secondaryConfigs}
              setConfig={onSetConfig}
              onClose={() => setShowMenu(null)}
            />
          )}
        </Dropdown>
      )}
    </>
  )
}

function removePendingImage(index: number, setPendingImages: React.Dispatch<React.SetStateAction<PendingImage[]>>) {
  setPendingImages((current) => {
    const removed = current[index]
    if (removed) URL.revokeObjectURL(removed.preview)
    return current.filter((_, itemIndex) => itemIndex !== index)
  })
}

function resizeInput(event: ChangeEvent<HTMLTextAreaElement>, setInputValue: (value: string) => void) {
  setInputValue(event.target.value)
  event.currentTarget.style.height = 'auto'
  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 140)}px`
}
