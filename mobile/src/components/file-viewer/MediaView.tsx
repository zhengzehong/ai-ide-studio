import { useRef, useState, type CSSProperties } from 'react'
import { AlertCircle, Headphones, Loader2 } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import { useMobileFileAssetUrl } from './use-mobile-file-asset-url'

export function MediaView({ file, projectId }: { file: FileContent; projectId: string }) {
  const asset = useMobileFileAssetUrl(projectId, file.path)
  const [retried, setRetried] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const resumeAt = useRef(0)
  const resumePlaying = useRef(false)

  const retry = (media: HTMLMediaElement): void => {
    if (retried) {
      setPlaybackFailed(true)
      return
    }
    resumeAt.current = media.currentTime
    resumePlaying.current = !media.paused
    setRetried(true)
    asset.refresh()
  }
  const restore = (media: HTMLMediaElement): void => {
    if (resumeAt.current > 0) media.currentTime = resumeAt.current
    if (resumePlaying.current) void media.play().catch(() => undefined)
  }

  const status = playbackFailed
    ? <div style={styles.state}><AlertCircle size={24} />当前设备不支持该媒体编码,可使用顶部下载按钮</div>
    : asset.error
    ? <div style={styles.state}><AlertCircle size={24} />{asset.error}</div>
    : asset.loading
      ? <div style={styles.state}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />正在加载媒体...</div>
      : null
  if (file.kind === 'video') {
    return (
      <div style={{ ...styles.container, background: '#000' }}>
        {status}
        <video
          key={asset.url}
          src={asset.url || undefined}
          controls
          playsInline
          preload="metadata"
          onError={(event) => retry(event.currentTarget)}
          onLoadedMetadata={(event) => restore(event.currentTarget)}
          style={styles.video}
        />
      </div>
    )
  }
  return (
    <div style={styles.audioContainer}>
      {status}
      <Headphones size={52} color="var(--primary)" />
      <strong style={styles.title}>{file.path.split(/[\\/]/).pop()}</strong>
      <audio
        key={asset.url}
        src={asset.url || undefined}
        controls
        preload="metadata"
        onError={(event) => retry(event.currentTarget)}
        onLoadedMetadata={(event) => restore(event.currentTarget)}
        style={styles.audio}
      />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: { position: 'relative', width: '100%', height: '100%', minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%', maxHeight: 'calc(100dvh - 180px)', objectFit: 'contain' },
  audioContainer: { position: 'relative', minHeight: '100%', padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 },
  audio: { width: 'min(100%, 520px)' },
  title: { maxWidth: '90%', color: 'var(--text-primary)', textAlign: 'center', wordBreak: 'break-all' },
  state: { position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', background: 'var(--bg)' },
}
