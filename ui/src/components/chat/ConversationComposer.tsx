import { useRef, useState } from 'react'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import type { ImageAttachmentInfo } from '../../stores/session-events'
import type { WorkspacePendingFile } from '../../pages/workspace/workspace-file-attachments'
import { partitionWorkspaceFiles } from '../../pages/workspace/workspace-file-attachments'
import { uploadSessionFile } from '../../services/session-file-upload'
import type { ConversationAdapter, ConversationUploadedFile } from './conversation-types'
import './conversation-pane.css'

const draftBySession = new Map<string, string>()

export function ConversationComposer({ adapter }: { adapter: ConversationAdapter }) {
  const [value, setValue] = useState(() => adapter.sessionId ? draftBySession.get(adapter.sessionId) || '' : '')
  const [sending, setSending] = useState(false)
  const [files, setFiles] = useState<WorkspacePendingFile[]>([])
  const [images, setImages] = useState<ImageAttachmentInfo[]>([])
  const [sendError, setSendError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = !!adapter.sessionId && !sending && (!!value.trim() || files.some((file) => file.status === 'uploaded') || images.length > 0)

  const addFiles = (selected: File[]): void => {
    if (!adapter.sessionId || !adapter.projectId) return
    const sessionId = adapter.sessionId
    const projectId = adapter.projectId
    const { images: imageFiles, files: regularFiles } = partitionWorkspaceFiles(selected)
    imageFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => setImages((current) => [...current, { data: String(reader.result).split(',')[1], mimeType: file.type, name: file.name }])
      reader.readAsDataURL(file)
    })
    regularFiles.forEach((file) => {
      const localId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`
      setFiles((current) => [...current, { localId, name: file.name, size: file.size, status: 'uploading' }])
      void uploadSessionFile({ projectId, sessionId, file }).then((uploaded) => {
        setFiles((current) => current.map((entry) => entry.localId === localId ? { localId, name: file.name, size: file.size, status: 'uploaded', uploaded } : entry))
      }).catch((error: unknown) => {
        setFiles((current) => current.map((entry) => entry.localId === localId ? { localId, name: file.name, size: file.size, status: 'error', error: error instanceof Error ? error.message : '上传失败' } : entry))
      })
    })
  }

  const updateValue = (next: string): void => {
    setValue(next)
    if (adapter.sessionId) draftBySession.set(adapter.sessionId, next)
  }
  const submit = async (): Promise<void> => {
    if (!canSend) return
    setSending(true)
    setSendError(null)
    try {
      const uploaded = files.filter((file): file is Extract<WorkspacePendingFile, { status: 'uploaded' }> => file.status === 'uploaded').map((file) => file.uploaded as ConversationUploadedFile)
      await adapter.sendPrompt(value.trim(), images, uploaded)
      updateValue(''); setImages([]); setFiles([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch (error) { setSendError(error instanceof Error ? error.message : '消息发送失败') } finally { setSending(false) }
  }

  return (
    <div className="conversation-composer">
      {sendError && <div className="conversation-composer-error" role="alert">{sendError}</div>}
      {(images.length > 0 || files.length > 0) && <div className="conversation-attachments">{images.map((image, index) => <span key={`${image.name}-${index}`}>{image.name || '图片'}</span>)}{files.map((file) => <span key={file.localId}>{file.name} · {file.status === 'uploading' ? '上传中' : file.status === 'error' ? file.error : '已上传'}</span>)}</div>}
      <textarea ref={textareaRef} value={value} onChange={(event) => { updateValue(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px` }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder={adapter.sessionId ? '输入消息...' : '先选择一个 Session'} disabled={!adapter.sessionId} rows={2} />
      <div className="conversation-toolbar">
        <input ref={inputRef} type="file" multiple hidden onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
        <button type="button" className="conversation-tool-button" onClick={() => inputRef.current?.click()} disabled={!adapter.sessionId} title="添加图片或文件"><Paperclip size={15} /></button>
        {adapter.capabilities.modes.length > 0 && <select value={adapter.capabilities.currentModeId || ''} onChange={(event) => { if (adapter.setMode) void adapter.setMode(event.target.value) }}><option value="">模式</option>{adapter.capabilities.modes.map((mode) => <option key={mode.modeId} value={mode.modeId}>{mode.name}</option>)}</select>}
        <div className="conversation-toolbar-spacer" />
        {adapter.usage && <span className="conversation-usage">{adapter.usage.contextUsed}/{adapter.usage.contextSize}</span>}
        {adapter.capabilities.configOptions.filter((option) => option.category !== 'model' && option.category !== 'mode' && option.id !== 'model' && option.id !== 'mode').map((option) => <select key={option.id} value={String(option.currentValue ?? '')} onChange={(event) => { if (adapter.setConfig) void adapter.setConfig(option.id, event.target.value) }} title={option.description || option.name}><option value="">{option.name}</option>{(option.options || []).map((entry) => <option key={entry.value} value={entry.value}>{entry.name}</option>)}</select>)}
        {adapter.capabilities.commands.length > 0 && <select value="" onChange={(event) => { if (event.target.value) updateValue(`${value ? `${value}\n` : ''}/${event.target.value} `) }}><option value="">命令</option>{adapter.capabilities.commands.map((command) => <option key={command.name} value={command.name}>/{command.name}</option>)}</select>}
        {adapter.capabilities.models.length > 0 && <select value={adapter.capabilities.currentModelId || ''} onChange={(event) => { if (adapter.setModel) void adapter.setModel(event.target.value) }}><option value="">模型</option>{adapter.capabilities.models.map((model) => <option key={model.modelId} value={model.modelId}>{model.name || model.modelId}</option>)}</select>}
        {adapter.streamingMessage && !adapter.streamingMessage.done && <button type="button" className="conversation-stop" onClick={() => { void adapter.cancel() }} title="停止生成"><Square size={14} fill="currentColor" /></button>}
        <button type="button" className="conversation-send" disabled={!canSend} onClick={() => { void submit() }} title="发送"><ArrowUp size={16} /></button>
      </div>
    </div>
  )
}
