import { useRef, useState } from 'react'
import { AlertCircle, Download, Headphones, Loader2 } from 'lucide-react'
import { useFileAssetUrl } from './use-file-asset-url'
import { downloadFile } from '../../services/file-download'

interface FileAssetViewProps {
  projectId: string
  path: string
  kind: 'image' | 'audio' | 'video'
  name?: string
  basePath?: string
}

export function FileAssetView({ projectId, path, kind, name, basePath }: FileAssetViewProps) {
  const asset = useFileAssetUrl(projectId, path, { basePath })
  const [retryCount, setRetryCount] = useState(0)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const resumeAt = useRef(0)
  const resumePlaying = useRef(false)

  const retry = (media?: HTMLMediaElement): void => {
    if (retryCount >= 1) {
      setPlaybackFailed(true)
      return
    }
    if (media) {
      resumeAt.current = media.currentTime
      resumePlaying.current = !media.paused
    }
    setRetryCount((value) => value + 1)
    asset.refresh()
  }
  const download = async (): Promise<void> => {
    const result = await downloadFile({ projectId, filePath: path, basePath, filename: name })
    if (!result.ok && !result.canceled) throw new Error(result.error ?? '涓嬭浇澶辫触')
  }
  const restore = (media: HTMLMediaElement): void => {
    if (resumeAt.current > 0) media.currentTime = resumeAt.current
    if (resumePlaying.current) void media.play().catch(() => undefined)
  }

  const status = playbackFailed
    ? <div style={stateStyle}><AlertCircle size={20} />{kind === 'image' ? '图片加载失败' : '当前浏览器不支持该媒体编码'}</div>
    : asset.error
    ? <div style={stateStyle}><AlertCircle size={20} />{asset.error}</div>
    : asset.loading
      ? <div style={stateStyle}><Loader2 size={20} className="spin" />正在加载资源...</div>
      : null
  if (kind === 'image') {
    return (
      <div style={imageWrap}>
        {status}
        {asset.url && <img
            src={asset.url}
            alt={name ?? path}
            referrerPolicy="no-referrer"
            onError={() => retry()}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />}
        <DownloadButton onClick={download} />
      </div>
    )
  }
  if (kind === 'video') {
    return (
      <div style={mediaWrap}>
        {status}
        <video
          key={asset.url}
          src={asset.url || undefined}
          controls
          playsInline
          preload="metadata"
          onError={(event) => retry(event.currentTarget)}
          onLoadedMetadata={(event) => restore(event.currentTarget)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
        />
        <DownloadButton onClick={download} />
      </div>
    )
  }
  return (
    <div style={{ ...mediaWrap, minHeight: 220, flexDirection: 'column' }}>
      {status}
      <Headphones size={40} color="var(--text-3)" />
      <strong>{name ?? path.split(/[\\/]/).pop()}</strong>
      <audio
        key={asset.url}
        src={asset.url || undefined}
        controls
        preload="metadata"
        onError={(event) => retry(event.currentTarget)}
        onLoadedMetadata={(event) => restore(event.currentTarget)}
        style={{ width: 'min(640px, 90%)' }}
      />
      <DownloadButton onClick={download} />
    </div>
  )
}

function DownloadButton({ onClick }: { onClick: () => Promise<void> }) {
  const [failed, setFailed] = useState(false)
  return (
    <button
      type="button"
      aria-label="下载文件"
      title={failed ? '下载失败,点击重试' : '下载文件'}
      onClick={() => {
        setFailed(false)
        void onClick().catch(() => setFailed(true))
      }}
      style={downloadButton}
    >
      {failed ? <AlertCircle size={18} color="var(--red)" /> : <Download size={18} />}
    </button>
  )
}

const stateStyle: React.CSSProperties = { position: 'absolute', inset: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3)', background: 'var(--bg-1)' }
const imageWrap: React.CSSProperties = { position: 'relative', height: '100%', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-1)' }
const mediaWrap: React.CSSProperties = { position: 'relative', height: '100%', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }
const downloadButton: React.CSSProperties = { position: 'absolute', right: 16, bottom: 16, zIndex: 2, width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }
