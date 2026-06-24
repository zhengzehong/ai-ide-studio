import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { ImageAttachmentInfo } from '../../stores/session-events'

interface TaskImageInputProps {
  images: ImageAttachmentInfo[]
  onChange: (images: ImageAttachmentInfo[]) => void
}

interface PendingTaskImage extends ImageAttachmentInfo {
  preview: string
}

export function TaskImageInput({ images, onChange }: TaskImageInputProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const imagesRef = useRef(images)

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => () => {
    imagesRef.current.forEach((image) => {
      if ('preview' in image && typeof image.preview === 'string') URL.revokeObjectURL(image.preview)
    })
  }, [])

  const addFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    for (const file of imageFiles) {
      const reader = new FileReader()
      reader.onload = () => {
        const next: PendingTaskImage = {
          data: (reader.result as string).split(',')[1],
          mimeType: file.type,
          name: file.name,
          preview: URL.createObjectURL(file),
        }
        const nextImages = [...imagesRef.current, next]
        imagesRef.current = nextImages
        onChange(nextImages)
      }
      reader.readAsDataURL(file)
    }
  }

  const removeImage = (index: number) => {
    const removed = images[index]
    if (removed && 'preview' in removed && typeof removed.preview === 'string') URL.revokeObjectURL(removed.preview)
    const nextImages = images.filter((_, i) => i !== index)
    imagesRef.current = nextImages
    onChange(nextImages)
  }

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    addFiles(files)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
    setDragging(false)
    if (files.length === 0) return
    e.preventDefault()
    addFiles(files)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.items).some((item) => item.type.startsWith('image/'))) {
      e.preventDefault()
      setDragging(true)
    }
  }

  return (
    <div
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      style={{
        border: `1px dashed ${dragging ? 'var(--blue)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: 10,
        background: dragging ? 'var(--blue-light)' : 'var(--bg-1)',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(Array.from(e.target.files || []))
          e.currentTarget.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg-0)',
          color: 'var(--text-2)',
          padding: '6px 10px',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <ImagePlus size={14} />
        添加图片
      </button>
      {images.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {images.map((image, index) => (
            <div key={`${image.name || 'image'}-${index}`} style={{ position: 'relative' }}>
              <img
                src={image.data ? `data:${image.mimeType};base64,${image.data}` : withCurrentToken(image.url || '')}
                alt={image.name || '附件'}
                style={{ width: 74, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--red)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function withCurrentToken(url: string): string {
  if (!url || typeof window === 'undefined') return url
  const token = new URLSearchParams(window.location.search).get('token')
  if (!token) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(token)}`
}
