import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCcw, Upload, X } from 'lucide-react'
import { ICON_MAP, ICON_OPTIONS } from '../agent-square/constants'

const PREVIEW_SIZE = 96
const CROP_SIZE = 320
const OUTPUT_SIZE = 128
const MAX_FILE_BYTES = 512 * 1024

export interface AvatarUploaderValue {
  avatarUrl: string | null
  icon: string
}

export interface AvatarUploaderProps {
  currentAvatarUrl?: string | null
  currentIcon?: string
  onChange: (value: AvatarUploaderValue) => void
  /** 上传后的 base64 预览(裁剪后,未持久化);父组件保存时负责调 assets.upload */
  pendingDataUrl?: string | null
  onPendingChange?: (dataUrl: string | null) => void
}

export function AvatarUploader(props: AvatarUploaderProps) {
  const { currentAvatarUrl, currentIcon = 'bot', onChange, pendingDataUrl, onPendingChange } = props
  const [cropOpen, setCropOpen] = useState(false)
  const [rawFile, setRawFile] = useState<string | null>(null)
  const [rawFileName, setRawFileName] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const previewUrl = pendingDataUrl ?? currentAvatarUrl ?? null
  const usingUpload = previewUrl !== null

  const handleFile = useCallback((file: File) => {
    setError(null)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('仅支持 PNG / JPG / WebP 格式')
      return
    }
    if (file.size > MAX_FILE_BYTES * 4) {
      setError('文件过大,请选择小于 2MB 的图片')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') return
      setRawFile(result)
      setRawFileName(file.name)
      setCropOpen(true)
    }
    reader.onerror = () => setError('读取文件失败')
    reader.readAsDataURL(file)
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    handleFile(file)
    e.target.value = ''
  }

  const handleCropConfirm = (dataUrl: string) => {
    onPendingChange?.(dataUrl)
    setCropOpen(false)
    setRawFile(null)
    onChange({ avatarUrl: dataUrl, icon: currentIcon })
  }

  const handleReset = () => {
    onPendingChange?.(null)
    onChange({ avatarUrl: null, icon: currentIcon })
  }

  const handleSelectIcon = (ic: string) => {
    onPendingChange?.(null)
    onChange({ avatarUrl: null, icon: ic })
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.row}>
        <div style={styles.preview}>
          {previewUrl ? (
            <img src={previewUrl} alt="头像" style={styles.previewImg} />
          ) : (
            <FallbackIcon name={currentIcon} />
          )}
        </div>
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.uploadBtn}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} /> 上传头像
          </button>
          <button type="button" style={styles.resetBtn} onClick={handleReset} disabled={!usingUpload}>
            <RotateCcw size={13} /> 重置
          </button>
          <div style={styles.hint}>PNG / JPG / WebP · ≤512KB · 128×128</div>
          {error && <div style={styles.error}>{error}</div>}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      <div style={styles.iconRow}>
        {ICON_OPTIONS.map((ic) => {
          const Ic = ICON_MAP[ic]
          const selected = !usingUpload && currentIcon === ic
          return (
            <button
              key={ic}
              type="button"
              onClick={() => handleSelectIcon(ic)}
              style={{
                ...styles.iconBtn,
                border: selected ? '2px solid var(--blue)' : '1px solid var(--border)',
                background: selected ? 'var(--blue-light)' : 'var(--bg-0)',
                color: selected ? 'var(--blue)' : 'var(--text-3)',
                opacity: usingUpload ? 0.5 : 1,
                cursor: usingUpload ? 'not-allowed' : 'pointer',
              }}
              title={ic}
            >
              {Ic && <Ic size={16} />}
            </button>
          )
        })}
      </div>
      {cropOpen && rawFile && (
        <CropModal
          initialSrc={rawFile}
          fileName={rawFileName}
          onConfirm={handleCropConfirm}
          onCancel={() => {
            setCropOpen(false)
            setRawFile(null)
          }}
        />
      )}
    </div>
  )
}

function FallbackIcon({ name }: { name: string }) {
  const Ic = ICON_MAP[name] ?? ICON_MAP.bot
  return <Ic size={36} color="var(--text-3)" />
}

const styles: Record<string, CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  preview: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: 12,
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  previewImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  actions: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1 },
  uploadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 500,
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  resetBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 12,
    background: 'var(--bg-1)',
    color: 'var(--text-2)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  hint: { fontSize: 11, color: 'var(--text-3)' },
  error: { fontSize: 12, color: 'var(--red, #dc2626)' },
  iconRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
}

interface CropModalProps {
  initialSrc: string
  fileName: string
  onConfirm: (dataUrl: string) => void
  onCancel: () => void
}

function CropModal({ initialSrc, fileName, onConfirm, onCancel }: CropModalProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const maxDim = 320
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
      setImgSize({ w: img.width * ratio, h: img.height * ratio })
    }
    img.src = initialSrc
  }, [initialSrc])

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    setOffset(clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy, imgSize, zoom))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const handleConfirm = () => {
    const img = imgRef.current
    if (!img || !imgSize) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cropBox = CROP_SIZE
    const scale = img.naturalWidth / (imgSize.w * zoom)
    const sx = (cropBox / 2 - offset.x) * scale
    const sy = (cropBox / 2 - offset.y) * scale
    const sSize = cropBox * scale

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    ctx.drawImage(img, sx - sSize / 2, sy - sSize / 2, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

    const dataUrl = canvas.toDataURL('image/png')
    onConfirm(dataUrl)
  }

  return (
    <div style={cropStyles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={cropStyles.dialog}>
        <div style={cropStyles.header}>
          <span style={cropStyles.title}>裁剪头像</span>
          <button type="button" style={cropStyles.closeBtn} onClick={onCancel}><X size={16} /></button>
        </div>
        <div style={cropStyles.body}>
          <div
            ref={containerRef}
            style={{
              ...cropStyles.cropArea,
              width: CROP_SIZE,
              height: CROP_SIZE,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {imgSize && (
              <img
                ref={imgRef}
                src={initialSrc}
                alt="待裁剪"
                draggable={false}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: imgSize.w * zoom,
                  height: imgSize.h * zoom,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
            )}
            <div style={cropStyles.cropBox} />
            <div style={cropStyles.hintOverlay}>拖动调整位置</div>
          </div>
          <div style={cropStyles.controls}>
            <label style={cropStyles.zoomLabel}>
              缩放
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                style={cropStyles.rangeInput}
              />
              <span style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 36 }}>{Math.round(zoom * 100)}%</span>
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{fileName}</div>
          </div>
        </div>
        <div style={cropStyles.footer}>
          <button type="button" style={cropStyles.cancelBtn} onClick={onCancel}>取消</button>
          <button type="button" style={cropStyles.confirmBtn} onClick={handleConfirm}>确认裁剪</button>
        </div>
      </div>
    </div>
  )
}

function clampOffset(x: number, y: number, size: { w: number; h: number } | null, zoom: number): { x: number; y: number } {
  if (!size) return { x, y }
  const w = size.w * zoom
  const h = size.h * zoom
  const maxX = Math.max(0, (w - CROP_SIZE) / 2)
  const maxY = Math.max(0, (h - CROP_SIZE) / 2)
  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
}

const cropStyles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 3000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 400,
    maxWidth: 'calc(100vw - 32px)',
    background: 'var(--bg-0)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: '1px solid var(--border)',
  },
  title: { fontSize: 15, fontWeight: 600, color: 'var(--text-1)' },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--text-3)',
    display: 'inline-flex',
    padding: 4,
    borderRadius: 4,
  },
  body: { padding: 18, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' },
  cropArea: {
    position: 'relative',
    background: '#000',
    overflow: 'hidden',
    cursor: 'grab',
    touchAction: 'none',
    borderRadius: 8,
  },
  cropBox: {
    position: 'absolute',
    inset: 0,
    border: '2px solid rgba(255,255,255,0.6)',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    borderRadius: 8,
  },
  hintOverlay: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    pointerEvents: 'none',
  },
  controls: { width: '100%', display: 'flex', flexDirection: 'column', gap: 8 },
  zoomLabel: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-2)' },
  rangeInput: { flex: 1, accentColor: 'var(--blue)' },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 18px',
    borderTop: '1px solid var(--border)',
  },
  cancelBtn: {
    padding: '6px 14px',
    fontSize: 13,
    border: '1px solid var(--border)',
    background: 'var(--bg-1)',
    color: 'var(--text-2)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  confirmBtn: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    background: 'var(--blue)',
    color: '#fff',
    borderRadius: 6,
    cursor: 'pointer',
  },
}
