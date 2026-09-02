import { useEffect, useState } from 'react'
import { sessionTagColor, appendSessionTag, MAX_SESSION_TAG_LENGTH, MAX_SESSION_TAGS } from './session-tags'

// 右键"设置标签…"的轻量编辑器：输入框回车/添加按钮创建新标签，
// 当前作用域已有 tag 点选打上、已选 chips 点删。每次变更立即提交（全量 replace）。
export interface SessionTagEditorProps {
  sessionTitle: string
  sessionTags: string[]
  scopeTags: string[]
  anchorX: number
  anchorY: number
  onChange: (tags: string[]) => void
  onClose: () => void
}

const POP_WIDTH = 236
const POP_MARGIN = 16

export function SessionTagEditor(props: SessionTagEditorProps) {
  const { sessionTags, scopeTags, anchorX, anchorY, onChange, onClose } = props
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const commitInput = (): void => {
    if (!inputValue.trim()) return
    const next = appendSessionTag(sessionTags, inputValue)
    setInputValue('')
    if (next !== sessionTags) onChange(next)
  }

  const removeTag = (tag: string): void => {
    onChange(sessionTags.filter((item) => item !== tag))
  }

  const addExistingTag = (tag: string): void => {
    if (sessionTags.includes(tag)) return
    if (sessionTags.length >= MAX_SESSION_TAGS) return
    onChange([...sessionTags, tag])
  }

  const otherTags = scopeTags.filter((tag) => !sessionTags.includes(tag))

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1098 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          zIndex: 1099,
          width: POP_WIDTH,
          left: Math.max(POP_MARGIN, Math.min(anchorX, window.innerWidth - POP_WIDTH - POP_MARGIN)),
          top: Math.max(POP_MARGIN, Math.min(anchorY + 6, window.innerHeight - 210)),
          background: 'var(--bg-0)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 12px 28px rgba(15,23,42,0.14), 0 3px 8px rgba(15,23,42,0.08)',
          padding: 10,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h4 style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)', margin: 0, marginBottom: 8 }}>
          设置标签 · {props.sessionTitle}
        </h4>
        <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
          <input
            value={inputValue}
            maxLength={MAX_SESSION_TAG_LENGTH}
            placeholder="输入标签,回车添加"
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitInput()
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              outline: 'none',
              background: 'var(--bg-0)',
              color: 'var(--text-1)',
            }}
          />
          <button
            type="button"
            onClick={commitInput}
            style={{
              fontSize: 12,
              padding: '0 10px',
              border: 'none',
              borderRadius: 6,
              background: 'var(--blue)',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            添加
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {sessionTags.map((tag) => {
            const [background, foreground] = sessionTagColor(tag)
            return (
              <button
                type="button"
                key={tag}
                onClick={() => removeTag(tag)}
                title="点击移除"
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  border: `1px solid ${foreground}`,
                  background,
                  color: foreground,
                  fontWeight: 500,
                }}
              >
                {tag} ✕
              </button>
            )
          })}
          {otherTags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => addExistingTag(tag)}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 999,
                cursor: 'pointer',
                border: '1px dashed var(--border)',
                background: 'var(--bg-1)',
                color: 'var(--text-2)',
              }}
            >
              + {tag}
            </button>
          ))}
          {sessionTags.length === 0 && otherTags.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>暂无已有标签,输入创建</span>
          )}
        </div>
      </div>
    </>
  )
}
