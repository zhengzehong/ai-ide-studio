import { ImagePlus, Save, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { AuthenticatedImage } from '../../components/chat/AuthenticatedImage'
import type { InspirationNote, PendingInspirationImage } from '../../stores/inspiration.store'

interface InspirationEditorProps {
  note: InspirationNote | null
  saving: boolean
  onSave: (input: {
    title: string
    sourceMarkdown: string
    keepAttachmentPaths: string[]
    images: PendingInspirationImage[]
  }) => Promise<void>
}

export function InspirationEditor({ note, saving, onSave }: InspirationEditorProps) {
  const [title, setTitle] = useState(note?.title ?? defaultTitle())
  const [sourceMarkdown, setSourceMarkdown] = useState(note?.sourceMarkdown ?? '')
  const [keptPaths, setKeptPaths] = useState<string[]>(
    note?.attachments.flatMap((item) => item.relativePath ? [item.relativePath] : []) ?? [],
  )
  const [images, setImages] = useState<PendingInspirationImage[]>([])
  const fileInput = useRef<HTMLInputElement | null>(null)

  const keptAttachments = useMemo(
    () => note?.attachments.filter((item) => item.relativePath && keptPaths.includes(item.relativePath)) ?? [],
    [keptPaths, note?.attachments],
  )
  const canSave = title.trim().length > 0 && sourceMarkdown.trim().length > 0 && !saving

  const chooseImages = async (files: FileList | null): Promise<void> => {
    if (!files) return
    const next = await Promise.all(Array.from(files).slice(0, 10 - images.length).map(readImage))
    setImages((current) => [...current, ...next])
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <section className="inspiration-editor">
      <div className="inspiration-editor-fields">
        <input className="inspiration-title-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} aria-label="灵感标题" />
        <textarea
          value={sourceMarkdown}
          onChange={(event) => setSourceMarkdown(event.target.value)}
          placeholder="直接记录想到的内容，支持 Markdown；图片可粘贴后通过附件按钮加入。"
          maxLength={50_000}
          aria-label="灵感内容"
        />
        {(keptAttachments.length > 0 || images.length > 0) && (
          <div className="inspiration-attachments">
            {keptAttachments.map((image) => (
              <figure key={image.relativePath}>
                <AuthenticatedImage image={image} alt={image.name || '灵感图片'} />
                <button type="button" onClick={() => setKeptPaths((paths) => paths.filter((path) => path !== image.relativePath))} title="移除图片" aria-label="移除图片"><X size={13} /></button>
              </figure>
            ))}
            {images.map((image, index) => (
              <figure key={`${image.name ?? 'image'}-${index}`}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name || '待上传图片'} />
                <button type="button" onClick={() => setImages((items) => items.filter((_, itemIndex) => itemIndex !== index))} title="移除图片" aria-label="移除图片"><X size={13} /></button>
              </figure>
            ))}
          </div>
        )}
      </div>
      <footer className="inspiration-editor-footer">
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void chooseImages(event.target.files)} />
        <button type="button" className="inspiration-secondary" onClick={() => fileInput.current?.click()}><ImagePlus size={15} />添加图片</button>
        <span>原文先保存，AI 整理失败不会丢失记录</span>
        <button type="button" className="inspiration-primary" disabled={!canSave} onClick={() => void onSave({ title: title.trim(), sourceMarkdown: sourceMarkdown.trim(), keepAttachmentPaths: keptPaths, images })}><Save size={15} />{saving ? '保存中…' : '保存并整理'}</button>
      </footer>
    </section>
  )
}

async function readImage(file: File): Promise<PendingInspirationImage> {
  if (!file.type.startsWith('image/')) throw new Error('仅支持图片')
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8MB`)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type, name: file.name }
}

function defaultTitle(): string {
  return new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) + ' 灵感'
}
