import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Check, ChevronDown, Circle, Mail, Paperclip, Send, Settings2, Square, Wrench, X } from 'lucide-react'
import type { ImageAttachmentInfo } from '../../stores/session-events'
import { createWorkspaceFileLocalId, MAX_WORKSPACE_FILES, partitionWorkspaceFiles, type WorkspacePendingFile } from '../../pages/workspace/workspace-file-attachments'
import { WorkspaceFileAttachmentList } from '../../pages/workspace/WorkspaceFileAttachmentList'
import { configLabel, configOptionLabel, fmtTokens, menuStyle, modeCn, type MenuAnchor, type MenuName } from '../../pages/workspace/helpers'
import { uploadSessionFile } from '../../services/session-file-upload'
import { pickEffortOption } from '../../../../src/shared/effort-config'
import type { ConversationAdapter, ConversationUploadedFile } from './conversation-types'
import { canSendConversation } from './conversation-composer-utils'
import { conversationDrafts, type ConversationDraft } from './conversation-drafts'
import './conversation-pane.css'

interface MenuItem {
  id: string
  label: string
  description?: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
}

/** 团队线目标菜单的菜单名（胶囊/权限）；档位沿用 config:<真实 configId>。 */
type TeamMenuName = 'teamTargets' | 'teamPerm'
const TEAM_MENUS: readonly string[] = ['teamTargets', 'teamPerm']

export function ConversationComposer({ adapter }: { adapter: ConversationAdapter }) {
  const initial = conversationDrafts.get(adapter.sessionId)
  const [value, setValue] = useState(initial.text)
  const [files, setFiles] = useState<WorkspacePendingFile[]>(initial.files)
  const [images, setImages] = useState<ImageAttachmentInfo[]>(initial.images)
  const [sending, setSending] = useState(false)
  const [stoppingTurnId, setStoppingTurnId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [stopError, setStopError] = useState<string | null>(null)
  const [queuedPromptNotice, setQueuedPromptNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<MenuName | TeamMenuName | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeSessionRef = useRef<string | null>(adapter.sessionId)
  const mountedRef = useRef(false)
  const valueRef = useRef(value)
  const imagesRef = useRef(images)
  const filesRef = useRef(files)
  const submittedSessionRef = useRef<string | null>(null)

  const connected = adapter.connected !== false
  const blocked = adapter.pendingPermissions.length > 0 || adapter.pendingElicitations.length > 0
  const streaming = !!adapter.streamingMessage && !adapter.streamingMessage.done
  const streamingTurnId = adapter.streamingMessage?.id ?? null
  const stopping = !!adapter.stopping || (streaming && stoppingTurnId === streamingTurnId)
  const currentMode = adapter.capabilities.modes.find((item) => item.modeId === adapter.capabilities.currentModeId)
  const currentModel = adapter.capabilities.models.find((item) => item.modelId === adapter.capabilities.currentModelId)
  const configs = adapter.capabilities.configOptions.filter((item) => item.category !== 'model' && item.category !== 'mode' && item.id !== 'model' && item.id !== 'mode')
  const activeConfig = menu?.startsWith('config:') ? configs.find((item) => `config:${item.id}` === menu) : undefined
  // ---- 团队线目标（可选插槽）：全体=现状语义；选中成员后档位/权限开关就地变为该成员的控制 ----
  const teamTarget = adapter.teamTarget
  const targetMember = teamTarget && teamTarget.targetId
    ? teamTarget.members.find((member) => member.id === teamTarget.targetId) ?? null
    : null
  // 档位项按统一匹配表从**目标成员**的 capabilities 里取（严禁对不存在的 configId 发写入）。
  const targetEffortOption = targetMember ? pickEffortOption(targetMember.capabilities.configOptions) : undefined
  const activeTargetConfig = targetMember && menu === (targetEffortOption ? `config:${targetEffortOption.id}` : '') ? targetEffortOption : undefined
  const targetMode = targetMember?.capabilities.modes.find((item) => item.modeId === targetMember.capabilities.currentModeId)
  const effortScopeNote = targetMember
    ? `对 ${targetMember.name} · ${targetMember.running ? '当前回合结束后生效' : '下一回合生效'}`
    : undefined
  const canSend = canSendConversation(
    adapter.sessionId,
    sending || adapter.sending || blocked || !connected || !!adapter.currentSessionCopying,
    value,
    files,
    images,
  )
  const displayedStopError = adapter.stopError || stopError

  useEffect(() => {
    conversationDrafts.prune(adapter.sessionId ? [adapter.sessionId] : [])
    const timer = window.setInterval(() => conversationDrafts.prune(adapter.sessionId ? [adapter.sessionId] : []), 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [adapter.sessionId])

  useEffect(() => {
    if (!adapter.sessionId) return
    const sessionId = adapter.sessionId
    conversationDrafts.replace(sessionId, { text: valueRef.current, images: imagesRef.current, files: filesRef.current })
    return () => {
      if (submittedSessionRef.current === sessionId) {
        submittedSessionRef.current = null
        return
      }
      conversationDrafts.replace(sessionId, { text: valueRef.current, images: imagesRef.current, files: filesRef.current })
    }
  }, [adapter.sessionId, files, images, value])

  useEffect(() => {
    if (!queuedPromptNotice) return undefined
    const timer = window.setTimeout(() => setQueuedPromptNotice(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [queuedPromptNotice])

  useEffect(() => {
    activeSessionRef.current = adapter.sessionId
  }, [adapter.sessionId])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!menu) return undefined
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menu])

  const resize = (): void => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }

  const updateDraft = (sessionId: string, updater: (draft: ConversationDraft) => ConversationDraft): void => {
    const next = conversationDrafts.update(sessionId, updater)
    if (!mountedRef.current || activeSessionRef.current !== sessionId) return
    imagesRef.current = next.images
    filesRef.current = next.files
    setImages(next.images)
    setFiles(next.files)
  }

  const updateValue = (next: string): void => {
    valueRef.current = next
    setValue(next)
  }

  const addImages = (selected: File[]): void => {
    const targetSessionId = adapter.sessionId
    if (!targetSessionId) return
    selected.filter((file) => file.type.startsWith('image/')).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result || '')
        const data = result.includes(',') ? result.split(',')[1] : result
        const image: ImageAttachmentInfo = { data, mimeType: file.type, name: file.name, url: URL.createObjectURL(file) }
        updateDraft(targetSessionId, (draft) => ({ ...draft, images: [...draft.images, image] }))
      }
      reader.onerror = () => { if (activeSessionRef.current === targetSessionId) setSendError('图片读取失败，请重试') }
      reader.readAsDataURL(file)
    })
  }

  const addFiles = (selected: File[]): void => {
    const targetSessionId = adapter.sessionId
    const projectId = adapter.projectId
    if (!targetSessionId || !projectId) return
    const currentFiles = conversationDrafts.get(targetSessionId).files
    const accepted = selected.slice(0, Math.max(0, MAX_WORKSPACE_FILES - currentFiles.length))
    if (accepted.length < selected.length) setSendError(`每条消息最多上传 ${MAX_WORKSPACE_FILES} 个普通文件`)
    accepted.forEach((file) => {
      const localId = createWorkspaceFileLocalId()
      updateDraft(targetSessionId, (draft) => ({ ...draft, files: [...draft.files, { localId, name: file.name, size: file.size, status: 'uploading' }] }))
      void uploadSessionFile({ projectId, sessionId: targetSessionId, file })
        .then((uploaded) => updateDraft(targetSessionId, (draft) => ({ ...draft, files: draft.files.map((item) => item.localId === localId ? { localId, name: file.name, size: uploaded.size, status: 'uploaded', uploaded } : item) })))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '文件上传失败'
          updateDraft(targetSessionId, (draft) => ({ ...draft, files: draft.files.map((item) => item.localId === localId ? { localId, name: file.name, size: file.size, status: 'error', error: message } : item) }))
          if (activeSessionRef.current === targetSessionId) setSendError(message)
        })
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
    if (!canSend || !adapter.sessionId) return
    const targetSessionId = adapter.sessionId
    // 定向发送：目标为某成员时消息走 team.member.message（绕过 Master），不进 Master 会话。
    const directedTo = targetMember && teamTarget ? targetMember : null
    const queuesBehindActiveTurn = streaming && !stopping
    setSending(true)
    setSendError(null)
    setStopError(null)
    setStoppingTurnId(null)
    try {
      if (directedTo) {
        const status = await teamTarget!.sendDirected(directedTo.id, value.trim())
        submittedSessionRef.current = targetSessionId
        conversationDrafts.clear(targetSessionId)
        if (activeSessionRef.current === targetSessionId) {
          valueRef.current = ''
          imagesRef.current = []
          filesRef.current = []
          setValue('')
          setImages([])
          setFiles([])
          setQueuedPromptNotice(status === 'queued'
            ? `已排队：${directedTo.name} 正在执行，空闲后自动执行（排队不丢失）`
            : `已定向发给 ${directedTo.name}`)
          requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.focus() } })
        }
        return
      }
      const uploaded = files.filter((file): file is Extract<WorkspacePendingFile, { status: 'uploaded' }> => file.status === 'uploaded').map((file) => file.uploaded as ConversationUploadedFile)
      await adapter.sendPrompt(value.trim(), images, uploaded)
      submittedSessionRef.current = targetSessionId
      conversationDrafts.clear(targetSessionId)
      if (activeSessionRef.current === targetSessionId) {
        valueRef.current = ''
        imagesRef.current = []
        filesRef.current = []
        setValue('')
        setImages([])
        setFiles([])
        if (queuesBehindActiveTurn) setQueuedPromptNotice('已排入下一轮')
        requestAnimationFrame(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.focus() } })
      }
    } catch (error) {
      if (activeSessionRef.current === targetSessionId) setSendError(error instanceof Error ? error.message : '消息发送失败，请重试')
    } finally { setSending(false) }
  }

  const stop = async (): Promise<void> => {
    if (!streaming || stopping) return
    if (!streamingTurnId) return
    setStoppingTurnId(streamingTurnId)
    setStopError(null)
    try { await adapter.cancel() } catch (error) { setStoppingTurnId(null); setStopError(error instanceof Error ? error.message : '停止失败，请重试') }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    addSelected(Array.from(event.dataTransfer.files))
  }

  const openMenu = (name: MenuName | TeamMenuName, event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuAnchor({ name: name as MenuName, left: rect.left, top: rect.top - 8, minWidth: rect.width })
    setMenu(menu === name ? null : name)
  }
  /** @ 唤起：锚在输入框本体（无按钮可点），与胶囊共用同一个成员菜单。 */
  const openMenuAtComposer = (name: TeamMenuName): void => {
    const rect = (textareaRef.current?.closest('.conversation-composer') ?? textareaRef.current)?.getBoundingClientRect()
    setMenuAnchor({ name: name as MenuName, left: rect?.left ?? 280, top: (rect?.top ?? 600) - 8, minWidth: rect?.width ?? 320 })
    setMenu(name)
  }

  const chooseCommand = (name: string): void => {
    updateValue(`/${name} `)
    setMenu(null)
    textareaRef.current?.focus()
  }

  const targetEffortLabel = (): string => {
    if (!targetEffortOption) return '档位不可用'
    const current = targetEffortOption.options?.find((option) => option.value === targetEffortOption.currentValue)
    const label = configOptionLabel(String(targetEffortOption.currentValue ?? ''), current?.name || targetEffortOption.name || '思考强度')
    // claude 哨兵值 'default' 在团队成员语境下明确显示为「跟随模型默认」。
    return targetEffortOption.currentValue === 'default' ? '跟随模型默认' : label
  }

  const menuItems: MenuItem[] = menu === 'teamTargets'
    ? [
      ...(teamTarget?.members ?? []).map((member) => ({
        id: member.id,
        label: member.name,
        description: `${member.model} · ${member.running ? '执行中' : '空闲'}${member.queued > 0 ? ` · 排队 ${member.queued}` : ''}`,
        active: teamTarget?.targetId === member.id,
        onClick: () => { teamTarget?.onSelect(member.id); setMenu(null) },
      })),
      {
        id: 'all',
        label: '全体',
        description: '消息发往 Master，与现状一致',
        active: !teamTarget?.targetId,
        onClick: () => { teamTarget?.onSelect(null); setMenu(null) },
      },
    ]
    : menu === 'teamPerm'
      ? [
        ...(targetMember?.capabilities.modes ?? []).map((item) => ({
          id: item.modeId,
          label: modeCn(item.name),
          description: item.description,
          active: item.modeId === targetMember?.capabilities.currentModeId,
          // P0 只做展示：权限模式不在 composer 就地编辑（工具可见集编辑在设置页），点条目只提示。
          onClick: () => { setMenu(null) },
        })),
        ...(targetMember
          ? [{
            id: 'open-permissions',
            label: '打开工具权限设置',
            // 按 runtime 分叉展示（claude=权限模式 / codex=审批+沙盒维度），P0 只做展示 + 跳转，不做就地编辑。
            description: `预选 ${targetMember.name} · ${targetMember.runtime === 'codex' ? 'codex 维度：审批 / 沙盒' : 'claude 维度：权限模式'}`,
            onClick: () => { teamTarget?.openToolPermissions(targetMember.id); setMenu(null) },
          }]
          : []),
      ]
      : menu === 'command'
        ? adapter.capabilities.commands.map((item) => ({ id: item.name, label: `/${item.name}`, description: item.description || item.input?.hint || '插入命令', onClick: () => chooseCommand(item.name) }))
        : menu === 'mode'
          ? adapter.capabilities.modes.map((item) => ({ id: item.modeId, label: modeCn(item.name), description: item.description, active: item.modeId === adapter.capabilities.currentModeId, onClick: () => { void adapter.setMode?.(item.modeId); setMenu(null) } }))
          : menu === 'model'
            ? adapter.capabilities.models.map((item) => ({ id: item.modelId, label: item.name || item.modelId, active: item.modelId === adapter.capabilities.currentModelId, onClick: () => { void adapter.setModel?.(item.modelId); setMenu(null) } }))
            : activeTargetConfig
              // 目标成员档位（就地控制）：写入该成员会话的档位 configOption，下一回合生效。
              ? activeTargetConfig.options?.map((option) => ({
                id: option.value,
                label: option.value === 'default' ? '跟随模型默认' : configOptionLabel(option.value, option.name),
                description: option.description,
                active: option.value === activeTargetConfig.currentValue,
                // 写入失败（冷会话/适配器拒绝）就地报错；本地值只在成功后回填，失败即保持原值（回滚语义）。
                onClick: () => {
                  if (targetMember) {
                    void teamTarget?.setTargetConfig(targetMember.id, activeTargetConfig.id, option.value)
                      .catch((error: unknown) => setSendError(error instanceof Error ? error.message : '档位写入失败，请重试'))
                  }
                  setMenu(null)
                },
              })) ?? []
              : activeConfig?.type === 'boolean'
                ? [{ id: 'toggle', label: activeConfig.name, active: activeConfig.currentValue === true, onClick: () => { void adapter.setConfig?.(activeConfig.id, activeConfig.currentValue !== true); setMenu(null) } }]
                : activeConfig?.options?.map((option) => ({ id: option.value, label: configOptionLabel(option.value, option.name), description: option.description, active: option.value === activeConfig.currentValue, onClick: () => { void adapter.setConfig?.(activeConfig.id, option.value); setMenu(null) } })) ?? []

  return (
    <div className="conversation-composer-shell">
      {(displayedStopError || sendError) && <div className="conversation-composer-error" role="alert">{displayedStopError || sendError}</div>}
      {queuedPromptNotice && <div className="conversation-composer-queued" role="status" aria-live="polite">{queuedPromptNotice}</div>}
      {images.length > 0 && <div className="conversation-image-attachments" aria-label="待发送图片">{images.map((image, index) => <div className="conversation-image-attachment" key={`${image.name || 'image'}-${index}`}><img src={image.url || `data:${image.mimeType};base64,${image.data || ''}`} alt={image.name || '图片'} /><button type="button" onClick={() => updateDraft(adapter.sessionId!, (draft) => ({ ...draft, images: draft.images.filter((_, itemIndex) => itemIndex !== index) }))} title="移除图片" aria-label={`移除 ${image.name || '图片'}`}><X size={10} /></button></div>)}</div>}
      <WorkspaceFileAttachmentList files={files} onRemove={(localId) => { if (adapter.sessionId) updateDraft(adapter.sessionId, (draft) => ({ ...draft, files: draft.files.filter((file) => file.localId !== localId) })) }} />
      <div className={`conversation-composer${dragging ? ' is-dragging' : ''}${!adapter.sessionId ? ' is-disabled' : ''}`} onDragOver={(event) => { if (Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) { event.preventDefault(); setDragging(true) } }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
        <textarea ref={textareaRef} value={value} onChange={(event) => {
          const next = event.target.value
          updateValue(next)
          resize()
          // @ 唤起：团队线里输入 @ 直接打开同一个成员菜单，选中后填入胶囊（普通会话无此行为）。
          if (teamTarget) {
            if (/@$/.test(next)) { if (menu !== 'teamTargets') openMenuAtComposer('teamTargets') }
            else if (menu === 'teamTargets') setMenu(null)
          }
        }} onKeyDown={handleKeyDown} onPaste={(event) => { const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/')); if (pasted.length > 0) { event.preventDefault(); addImages(pasted) } }} placeholder={adapter.currentSessionCopying ? '正在复制会话，完成后可继续输入...' : blocked ? '等待你确认后继续...' : adapter.sessionId ? '输入消息...' : '先选择一个 Session'} disabled={!adapter.sessionId || !connected || blocked || !!adapter.currentSessionCopying || sending || adapter.sending} autoFocus rows={2} />
        <div className="conversation-toolbar">
          <input ref={inputRef} type="file" multiple hidden onChange={handleFileChange} />
          {/* 目标胶囊（团队线专属，可选插槽）：工具栏最左与 📎 同排；默认「全体」＝现状语义 */}
          {teamTarget && (
            <button
              type="button"
              className={`conversation-toolbar-button${targetMember ? ' is-directed' : ''}`}
              onClick={(event) => openMenu('teamTargets', event)}
              title={targetMember ? `发送目标：${targetMember.name}（定向消息绕过 Master）` : '发送目标：全体（默认，与现状一致）'}
              aria-haspopup="menu"
            >
              <Mail size={12} />{targetMember ? <span>{targetMember.name}</span> : '全体'}
              {targetMember && (
                <span
                  role="button"
                  aria-label="清除目标，回到全体"
                  title="清除目标，回到全体"
                  className="composer-target-clear"
                  onClick={(event) => { event.stopPropagation(); teamTarget.onSelect(null); setMenu(null) }}
                >✕</span>
              )}
              <ChevronDown size={10} />
            </button>
          )}
          <button type="button" className="conversation-tool-button" onClick={() => inputRef.current?.click()} disabled={!adapter.sessionId || !!adapter.currentSessionCopying || sending} title="添加图片或文件"><Paperclip size={15} /></button>
          {adapter.capabilities.commands.length > 0 && <ToolbarButton label="命令" icon={<Wrench size={12} />} active={menu === 'command'} onClick={(event) => openMenu('command', event)} />}
          {targetMember ? (
            /* 权限开关复用现成按钮：选中成员后就地变为该成员控制（P0 展示 + 跳转设置，不做就地编辑） */
            <button
              type="button"
              className="conversation-toolbar-button"
              disabled={targetMember.capabilities.modes.length === 0}
              title={targetMember.capabilities.modes.length === 0
                ? `${targetMember.name} 为旧 codex 适配器成员：无独立权限项（权限挂在模型选择上，维持现状）`
                : `权限：${targetMember.name} · ${effortScopeNote ?? ''}`}
              onClick={(event) => openMenu('teamPerm', event)}
              aria-haspopup="menu"
            >
              <Settings2 size={12} />{targetMember.capabilities.modes.length === 0 ? '权限项不可用' : modeCn(targetMode?.name)}<ChevronDown size={10} />
            </button>
          ) : (
            adapter.capabilities.modes.length > 0 && <ToolbarButton label={modeCn(currentMode?.name)} icon={<Settings2 size={12} />} active={menu === 'mode'} onClick={(event) => openMenu('mode', event)} />
          )}
          <div className="conversation-toolbar-spacer" />
          {targetMember ? (
            /* 档位开关复用现成按钮：选中成员后就地变为该成员控制（capabilities 驱动，不新造 chip） */
            <button
              type="button"
              className={`conversation-toolbar-button is-transparent${menu === (targetEffortOption ? `config:${targetEffortOption.id}` : '') ? ' is-active' : ''}`}
              disabled={!targetEffortOption}
              title={targetEffortOption ? `思考强度：${targetMember.name} · ${effortScopeNote ?? ''}` : `${targetMember.name} 为旧 codex 适配器成员：无独立档位项（effort 挂在模型选择上，维持现状）`}
              onClick={(event) => { if (targetEffortOption) openMenu(`config:${targetEffortOption.id}`, event) }}
              aria-haspopup={targetEffortOption ? 'menu' : undefined}
            >
              {targetEffortLabel()}{targetEffortOption && <ChevronDown size={10} />}
            </button>
          ) : (
            configs.map((item) => <ToolbarButton key={item.id} label={configLabel(item)} active={menu === `config:${item.id}`} onClick={(event) => openMenu(`config:${item.id}`, event)} />)
          )}
          {adapter.usage && <MiniContextCircle used={adapter.usage.contextUsed} total={adapter.usage.contextSize} />}
          {adapter.capabilities.models.length > 0 && <ToolbarButton label={currentModel?.name || '模型'} active={menu === 'model'} onClick={(event) => openMenu('model', event)} transparent />}
          {blocked && <span className="conversation-toolbar-status conversation-toolbar-status--error">等待确认</span>}
          {stopping && <span className="conversation-toolbar-status">正在停止</span>}
          {streaming && <button type="button" className="conversation-stop" onClick={() => { void stop() }} disabled={stopping} title={stopping ? '停止处理中' : '停止生成'}><Square size={14} fill="currentColor" /></button>}
          <button type="button" className="conversation-send" disabled={!canSend} onClick={() => { void submit() }} title={targetMember ? `发送给 ${targetMember.name}` : '发送'}>{targetMember ? <Send size={15} /> : <ArrowUp size={16} />}</button>
        </div>
      </div>
      {menu && menuItems.length > 0 && <ConversationDropdown anchor={menuAnchor} items={menuItems} command={menu === 'command'} header={TEAM_MENUS.includes(menu) || activeTargetConfig ? effortScopeNote : undefined} onClose={() => setMenu(null)} />}
    </div>
  )
}

function ToolbarButton({ label, icon, active, transparent = false, onClick }: { label: string; icon?: ReactNode; active: boolean; transparent?: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }): ReactNode {
  return <button type="button" className={`conversation-toolbar-button${active ? ' is-active' : ''}${transparent ? ' is-transparent' : ''}`} onClick={onClick}>{icon}{label}<ChevronDown size={10} /></button>
}

function MiniContextCircle({ used, total }: { used: number; total: number }): ReactNode {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--blue)'
  return <span className="conversation-context" title={`上下文: ${fmtTokens(used)} / ${fmtTokens(total)}`}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r={radius} fill="none" stroke="var(--bg-3)" strokeWidth="2" /><circle cx="9" cy="9" r={radius} fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${(circumference * pct) / 100} ${circumference}`} strokeDashoffset={circumference * 0.25} strokeLinecap="round" /></svg><span>{fmtTokens(used)}/{fmtTokens(total)}</span></span>
}

function ConversationDropdown({ anchor, items, command, header, onClose }: { anchor: MenuAnchor | null; items: MenuItem[]; command: boolean; header?: string; onClose: () => void }): ReactNode {
  if (!anchor || typeof document === 'undefined') return null
  return createPortal(<><div className="conversation-menu-backdrop" onClick={onClose} aria-hidden="true" /><div className="conversation-menu" role="menu" style={menuStyle(anchor, command ? 320 : 280)}>{header && <div className="conversation-menu-scope">{header}</div>}{items.map((item) => <button type="button" role="menuitem" key={item.id} onClick={item.onClick} className={item.active ? 'is-active' : ''} disabled={item.disabled}>{!command && (item.active ? <Check size={13} /> : <Circle size={13} />)}<span className="conversation-menu-copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span></button>)}</div></>, document.body)
}
