import { useState, useRef, type CSSProperties, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react'
import { Send, Square, ImagePlus, X } from 'lucide-react'
import type { ImageAttachmentInfo } from '@desktop/stores/session-events'

interface Props {
  onSend: (text: string, images?: ImageAttachmentInfo[]) => void
  onCancel: () => void
  isRunning: boolean
  disabled?: boolean
  disabledPlaceholder?: string
  supportsImages?: boolean
}

export default function ChatInput({ onSend, onCancel, isRunning, disabled, disabledPlaceholder, supportsImages }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImageAttachmentInfo[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    if ((!text.trim() && images.length === 0) || disabled) return
    onSend(text.trim(), images.length > 0 ? images : undefined)
    setText('')
    setImages([])
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        if (base64) {
          setImages(prev => [...prev, { data: base64, mimeType: file.type, name: file.name }])
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  return (
    <div style={styles.container}>
      {images.length > 0 && (
        <div style={styles.imagePreview}>
          {images.map((img, i) => (
            <div key={i} style={styles.imageThumb}>
              <img src={`data:${img.mimeType};base64,${img.data}`} style={styles.thumbImg} alt="" />
              <button style={styles.removeImg} onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}>
                <X size={10} color="#fff" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} style={styles.form}>
        {supportsImages && (
          <>
            <button type="button" style={styles.attachBtn} onClick={() => fileRef.current?.click()} disabled={disabled}>
              <ImagePlus size={18} color="var(--text-muted)" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />
          </>
        )}
        <textarea
          ref={inputRef}
          style={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? (disabledPlaceholder || '等待确认...') : '输入消息...'}
          disabled={disabled}
          rows={1}
        />
        {isRunning ? (
          <button type="button" style={styles.cancelBtn} onClick={onCancel} title="取消">
            <Square size={16} fill="var(--error)" color="var(--error)" />
          </button>
        ) : (
          <button
            type="submit"
            style={{ ...styles.sendBtn, opacity: (text.trim() || images.length > 0) && !disabled ? 1 : 0.4 }}
            disabled={(!text.trim() && images.length === 0) || disabled}
          >
            <Send size={16} color="#fff" />
          </button>
        )}
      </form>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    borderTop: '1px solid var(--border-light)',
    background: 'var(--bg-card)',
    padding: '8px 12px',
    paddingBottom: 'calc(8px + var(--safe-bottom))',
    flexShrink: 0,
  },
  imagePreview: {
    display: 'flex',
    gap: 6,
    paddingBottom: 8,
    overflowX: 'auto',
  },
  imageThumb: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  removeImg: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  form: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
  },
  attachBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    padding: '8px 12px',
    fontSize: 15,
    lineHeight: 1.4,
    resize: 'none',
    outline: 'none',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'var(--primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'opacity .2s',
  },
  cancelBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#fef2f2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
}
