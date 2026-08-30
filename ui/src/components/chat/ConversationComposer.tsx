import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, ChevronDown, Paperclip, Square, Settings2, Wrench, X } from 'lucide-react'
import type { ImageAttachmentInfo } from '../../stores/session-events'
import { createWorkspaceFileLocalId, MAX_WORKSPACE_FILES, partitionWorkspaceFiles, type WorkspacePendingFile } from '../../pages/workspace/workspace-file-attachments'
import { WorkspaceFileAttachmentList } from '../../pages/workspace/WorkspaceFileAttachmentList'
import { uploadSessionFile } from '../../services/session-file-upload'
import type { ConversationAdapter, ConversationUploadedFile } from './conversation-types'
import { canSendConversation } from './conversation-composer-utils'
import { configLabel, modeCn } from '../../pages/workspace/helpers'
import './conversation-pane.css'

interface DraftState {
  text: string
  images: ImageAttachmentInfo[]
  files: WorkspacePendingFile[]
}

const drafts = new Map<string, DraftState>()
type MenuName = 'command' | 'mode' | 'model' | string

export function ConversationComposer({ adapter }: { adapter: ConversationAdapter }) {
  const initial = adapter.sessionId ? drafts.get(adapter.sessionId) : undefined
  const [value, setValue] = useState(initial?.text ?? '')
  const [files, setFiles] = useState<WorkspacePendingFile[]>(initial?.files ?? [])
  const [images, setImages] = useState<ImageAttachmentInfo[]>(initial?.images ?? [])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<MenuName | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const blocked = adapter.pendingPermissions.length > 0 || adapter.pendingElicitations.length > 0
  const canSend = canSendConversation(adapter.sessionId, sending || blocked, value, files, images)
  const currentMode = adapter.capabilities.modes.find((item) => item.modeId === adapter.capabilities.currentModeId)
  const currentModel = adapter.capabilities.models.find((item) => item.modelId === adapter.capabilities.currentModelId)
  const configs = adapter.capabilities.configOptions.filter((item) => item.category !== 'model' && item.category !== 'mode' && item.id !== 'model' && item.id !== 'mode')

  useEffect(() => {
    if (!adapter.sessionId) return
    drafts.set(adapter.sessionId, { text: value, images, files })
  }, [adapter.sessionId, files, images, value])

  useEffect(() => {
    if (!menu) return undefined
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menu])

  const resize = (): void => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  const addImages = (selected: File[]): void => {
    selected.filter((file) => file.type.startsWith('image/')).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => setImages((current) => [...current, { data: String(reader.result).split(',')[1], mimeType: file.type, name: file.name, url: URL.createObjectURL(file) }])
      reader.readAsDataURL(file)
    })
  }

  const removeImage = (index: number): void => {
    setImages((current) => {
      const removed = current[index]
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url)
      return current.filter((_, itemIndex) => itemIndex !== index)
    })
  }

  const addFiles = (selected: File[]): void => {
    if (!adapter.sessionId || !adapter.projectId) return
    const accepted = selected.slice(0, Math.max(0, MAX_WORKSPACE_FILES - files.length))
    if (accepted.length < selected.length) setSendError(`每条消息最多上传 ${MAX_WORKSPACE_FILES} 个普通文件`)
    accepted.forEach((file) => {
      const localId = createWorkspaceFileLocalId()
      setFiles((current) => [...current, { localId, name: file.name, size: file.size, status: 'uploading' }])
      void uploadSessionFile({ projectId: adapter.projectId!, sessionId: adapter.sessionId!, file })
        .then((uploaded) => setFiles((current) => current.map((item) => item.localId === localId ? { localId, name: file.name, size: uploaded.size, status: 'uploaded', uploaded } : item)))
        .catch((error: unknown) => setFiles((current) => current.map((item) => item.localId === localId ? { localId, name: file.name, size: file.size, status: 'error', error: error instanceof Error ? error.message : '文件上传失败' } : item)))
    })
  }

  const addSelected = (selected: File[]): void => {
    const split = partitionWorkspaceFiles(selected)
    addImages(split.images)
    addFiles(split.files)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    addSelected(Array.from(event.target.files ?? []))
    event.currentTarget.value = ''
  }

  const submit = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    setSendError(null)
    try {
      const uploaded = files.filter((file): file is Extract<WorkspacePendingFile, { status: 'uploaded' }> => file.status === 'uploaded').map((file) => file.uploaded as ConversationUploadedFile)
      await adapter.sendPrompt(value.trim(), images, uploaded)
      if (adapter.sessionId) drafts.delete(adapter.sessionId)
      images.forEach((image) => { if (image.url?.startsWith('blob:')) URL.revokeObjectURL(image.url) })
      setValue(''); setImages([]); setFiles([]); resize()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '消息发送失败，请重试')
    } finally { setSending(false) }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault(); setDragging(false); addSelected(Array.from(event.dataTransfer.files))
  }

  const chooseCommand = (name: string): void => {
    setValue((current) => `${current ? `${current}\n` : ''}/${name} `)
    setMenu(null)
    textareaRef.current?.focus()
  }

  const menuItems = menu === 'command'
    ? adapter.capabilities.commands.map((item) => ({ id: item.name, label: `/${item.name}`, description: item.description || item.input?.hint || '', onClick: () => chooseCommand(item.name) }))
    : menu === 'mode'
      ? adapter.capabilities.modes.map((item) => ({ id: item.modeId, label: item.name, description: item.description || '', onClick: () => { void adapter.setMode?.(item.modeId); setMenu(null) } }))
      : menu === 'model'
        ? adapter.capabilities.models.map((item) => ({ id: item.modelId, label: item.name || item.modelId, description: '', onClick: () => { void adapter.setModel?.(item.modelId); setMenu(null) } }))
        : configs.find((item) => item.id === menu)?.options?.map((option) => ({ id: option.value, label: option.name, description: option.description || '', onClick: () => { void adapter.setConfig?.(menu!, option.value); setMenu(null) } })) ?? []

  return (
    <div className="conversation-composer-shell">
      {sendError && <div className="conversation-composer-error" role="alert">{sendError}</div>}
      {images.length > 0 && <div className="conversation-image-attachments" aria-label="待发送图片">{images.map((image, index) => <div className="conversation-image-attachment" key={`${image.name || 'image'}-${index}`}><img src={image.url || `data:${image.mimeType};base64,${image.data || ''}`} alt={image.name || '图片'} /><button type="button" onClick={() => removeImage(index)} title="移除图片" aria-label={`移除 ${image.name || '图片'}`}><X size={10} /></button></div>)}</div>}
      <WorkspaceFileAttachmentList files={files} onRemove={(localId) => setFiles((current) => current.filter((file) => file.localId !== localId))} />
      <div className={`conversation-composer${dragging ? ' is-dragging' : ''}${!adapter.sessionId ? ' is-disabled' : ''}`} onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) { event.preventDefault(); setDragging(true) } }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
        <textarea ref={textareaRef} value={value} onChange={(event) => { setValue(event.target.value); resize() }} onKeyDown={handleKeyDown} onPaste={(event) => { const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/')); if (pasted.length > 0) { event.preventDefault(); addImages(pasted) } }} placeholder={adapter.sessionId ? '输入消息...' : '先选择一个 Session'} disabled={!adapter.sessionId || sending || blocked} autoFocus rows={2} />
        <div className="conversation-toolbar">
          <input ref={inputRef} type="file" multiple hidden onChange={handleFileChange} />
          <button type="button" className="conversation-tool-button" onClick={() => inputRef.current?.click()} disabled={!adapter.sessionId || sending} title="添加图片或文件"><Paperclip size={15} /></button>
          {adapter.capabilities.commands.length > 0 && <ToolbarButton label="命令" icon={<Wrench size={12} />} active={menu === 'command'} onClick={() => setMenu(menu === 'command' ? null : 'command')} />}
          {adapter.capabilities.modes.length > 0 && <ToolbarButton label={modeCn(currentMode?.name)} icon={<Settings2 size={12} />} active={menu === 'mode'} onClick={() => setMenu(menu === 'mode' ? null : 'mode')} />}
          <div className="conversation-toolbar-spacer" />
          {adapter.usage && <span className="conversation-usage" title={`上下文 ${adapter.usage.contextUsed}/${adapter.usage.contextSize}`}>{adapter.usage.contextUsed}/{adapter.usage.contextSize}</span>}
          {configs.map((item) => <ToolbarButton key={item.id} label={configLabel(item)} active={menu === item.id} onClick={() => setMenu(menu === item.id ? null : item.id)} />)}
          {adapter.capabilities.models.length > 0 && <ToolbarButton label={currentModel?.name || '模型'} active={menu === 'model'} onClick={() => setMenu(menu === 'model' ? null : 'model')} />}
          {adapter.streamingMessage && !adapter.streamingMessage.done && <button type="button" className="conversation-stop" onClick={() => { void adapter.cancel() }} title="停止生成"><Square size={14} fill="currentColor" /></button>}
          <button type="button" className="conversation-send" disabled={!canSend} onClick={() => { void submit() }} title="发送"><ArrowUp size={16} /></button>
        </div>
        {menu && menuItems.length > 0 && <><div className="conversation-menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" /><div className="conversation-menu" role="menu">{menuItems.map((item) => <button type="button" role="menuitem" key={item.id} onClick={item.onClick}><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</button>)}</div></>}
      </div>
    </div>
  )
}

function ToolbarButton({ label, icon, active, onClick }: { label: string; icon?: ReactNode; active: boolean; onClick: () => void }): ReactNode {
  return <button type="button" className={`conversation-toolbar-button${active ? ' is-active' : ''}`} onClick={onClick}>{icon}{label}<ChevronDown size={10} /></button>
}
