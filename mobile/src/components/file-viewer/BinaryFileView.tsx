import { useState, type CSSProperties } from 'react'
import { Download, FileQuestion, Loader2, Check, AlertCircle } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import { buildAssetUrl } from '../../stores/filesystem.store'

interface BinaryFileViewProps {
  file: FileContent
}

type DownloadState = 'idle' | 'downloading' | 'success' | 'error'

export function BinaryFileView({ file }: BinaryFileViewProps) {
  const [state, setState] = useState<DownloadState>('idle')
  const [message, setMessage] = useState('')

  const handleDownload = async () => {
    if (state === 'downloading') return
    setState('downloading')
    setMessage('正在下载...')
    try {
      await download(file)
      setState('success')
      setMessage('已保存到下载目录')
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : '下载失败')
    }
    setTimeout(() => {
      setState('idle')
      setMessage('')
    }, 2000)
  }

  const fileName = file.path.split('/').pop() || file.path

  return (
    <div style={styles.container}>
      <div style={styles.iconWrap}>
        {state === 'downloading' ? (
          <Loader2 size={48} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
        ) : state === 'success' ? (
          <Check size={48} color="var(--success)" />
        ) : state === 'error' ? (
          <AlertCircle size={48} color="var(--error)" />
        ) : (
          <FileQuestion size={48} color="var(--text-muted)" />
        )}
      </div>
      <div style={styles.fileName}>{fileName}</div>
      <div style={styles.fileMeta}>
        {formatSize(file.size)} · {file.extension || '未知类型'}
      </div>
      <div style={styles.hint}>
        此文件类型不支持预览,可下载到本地查看
      </div>
      <button
        style={{
          ...styles.downloadBtn,
          opacity: state === 'downloading' ? 0.6 : 1,
        }}
        onClick={handleDownload}
        disabled={state === 'downloading'}
      >
        <Download size={18} />
        <span>{state === 'downloading' ? '下载中...' : '下载到手机'}</span>
      </button>
      {message && (
        <div style={{
          ...styles.message,
          color: state === 'success' ? 'var(--success)' : state === 'error' ? 'var(--error)' : 'var(--text-muted)',
        }}>
          {message}
        </div>
      )}
    </div>
  )
}

BinaryFileView.download = download

async function download(file: FileContent): Promise<void> {
  const url = buildAssetUrl(file.path, 'attachment')
  const fileName = file.path.split('/').pop() || file.path

  const isCapacitorAndroid = typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true

  if (isCapacitorAndroid) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`下载失败 (${resp.status})`)
    const blob = await resp.blob()
    const base64 = await blobToBase64(blob)
    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    })
    return
  }

  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('读取文件失败'))
        return
      }
      const commaIdx = result.indexOf(',')
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 40,
    height: '100%',
    background: 'var(--bg)',
  },
  iconWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: 'var(--primary-bg)',
  },
  fileName: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    textAlign: 'center',
    wordBreak: 'break-all',
    maxWidth: '80%',
  },
  fileMeta: {
    fontSize: 13,
    color: 'var(--text-muted)',
  },
  hint: {
    fontSize: 13,
    color: 'var(--text-muted)',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 1.5,
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 24px',
    borderRadius: 'var(--radius)',
    border: 'none',
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: 8,
  },
  message: {
    fontSize: 13,
    textAlign: 'center',
  },
}
