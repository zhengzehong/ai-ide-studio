import { useEffect, useState } from 'react'

interface PreviewModalPreview {
  previewId: string
  title: string
  target: 'pc' | 'app'
  url: string
  taskId?: string | null
}

interface PreviewModalProps {
  preview: PreviewModalPreview
  onClose: () => void
}

type Mode = 'phone' | 'full'

export function PreviewModal({ preview, onClose }: PreviewModalProps) {
  const initialMode: Mode = preview.target === 'app' ? 'phone' : 'full'
  const [mode, setMode] = useState<Mode>(initialMode)
  const [iframeKey, setIframeKey] = useState(0)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const refresh = () => setIframeKey((k) => k + 1)

  const isPhone = mode === 'phone'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1500,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 460,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 14,
              color: '#fff',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {preview.title}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={refresh}
              title="刷新"
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: '#27272a',
                border: '1px solid #3f3f46',
                color: '#d4d4d8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
            >
              🔄
            </button>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: '#27272a',
                border: '1px solid #3f3f46',
                color: '#d4d4d8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div
          style={{
            width: isPhone ? 390 : '90vw',
            height: isPhone ? 844 : '85vh',
            background: '#000',
            borderRadius: isPhone ? 40 : 8,
            padding: isPhone ? 12 : 0,
            boxShadow: '0 20px 60px rgba(0,0,0,.5), 0 0 0 2px #27272a',
            position: 'relative',
            transition: 'all .3s',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: '#fff',
              borderRadius: isPhone ? 30 : 8,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {isPhone && (
              <div
                style={{
                  height: 36,
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 24px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#000',
                  flexShrink: 0,
                }}
              >
                <span>9:41</span>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
                  📶 🔋
                </span>
              </div>
            )}
            <iframe
              key={iframeKey}
              src={preview.url}
              title={preview.title}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              style={{
                width: '100%',
                flex: 1,
                border: 'none',
                background: '#fff',
              }}
            />
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 8,
            background: '#27272a',
            padding: 4,
            borderRadius: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setMode('phone')}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              color: isPhone ? '#fff' : '#a1a1aa',
              background: isPhone ? '#3f3f46' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 5,
            }}
          >
            📱 手机框
          </button>
          <button
            type="button"
            onClick={() => setMode('full')}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              color: !isPhone ? '#fff' : '#a1a1aa',
              background: !isPhone ? '#3f3f46' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 5,
            }}
          >
            🖥 全屏
          </button>
        </div>
      </div>
    </div>
  )
}
