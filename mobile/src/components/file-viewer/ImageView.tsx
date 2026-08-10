import { useState, type CSSProperties } from 'react'
import { Download } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import { BinaryFileView } from './BinaryFileView'
import { useMobileFileAssetUrl } from './use-mobile-file-asset-url'

interface ImageViewProps {
  file: FileContent
  projectId: string
}

export function ImageView({ file, projectId }: ImageViewProps) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retried, setRetried] = useState(false)
  const asset = useMobileFileAssetUrl(projectId, file.path)

  return (
    <div style={styles.container}>
      {asset.loading || (!loaded && !failed) ? (
        <div style={styles.placeholder}>加载中...</div>
      ) : null}
      {(failed || asset.error) && <div style={styles.placeholder}>{asset.error || '图片加载失败'}</div>}
      {asset.url && (
        <img
          src={asset.url}
          alt={file.path}
          referrerPolicy="no-referrer"
          style={{ ...styles.img, opacity: loaded && !failed ? 1 : 0 }}
          onLoad={() => { setLoaded(true); setFailed(false) }}
          onError={() => {
            if (!retried) {
              setRetried(true)
              asset.refresh()
              return
            }
            setFailed(true)
          }}
        />
      )}
      <button
        style={styles.downloadFab}
        onClick={() => void BinaryFileView.download(file, projectId)}
        aria-label="下载"
      >
        <Download size={20} color="#fff" />
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
    padding: 16,
    background: '#000',
  },
  placeholder: {
    position: 'absolute',
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  img: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    transition: 'opacity 0.2s ease',
  },
  downloadFab: {
    position: 'absolute',
    right: 16,
    bottom: 'calc(16px + var(--safe-bottom))',
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
}
