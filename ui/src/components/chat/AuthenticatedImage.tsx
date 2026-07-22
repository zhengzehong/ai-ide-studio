import { useEffect, useState, type CSSProperties } from 'react'
import type { ImageAttachmentInfo } from '../../stores/session-events'
import { authenticatedImageLoader } from '../../services/authenticated-image'

export function AuthenticatedImage({
  image,
  alt,
  className,
  style,
}: {
  image: ImageAttachmentInfo
  alt: string
  className?: string
  style?: CSSProperties
}) {
  if (image.data) {
    return (
      <img
        src={`data:${image.mimeType};base64,${image.data}`}
        alt={alt}
        className={className}
        style={style}
      />
    )
  }
  if (!image.url) return <ImagePlaceholder alt={alt} className={className} style={style} />
  return <RemoteAuthenticatedImage url={image.url} alt={alt} className={className} style={style} />
}

function RemoteAuthenticatedImage({
  url,
  alt,
  className,
  style,
}: {
  url: string
  alt: string
  className?: string
  style?: CSSProperties
}) {
  const [loaded, setLoaded] = useState<{ url: string; source: string } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void authenticatedImageLoader.load(url)
      .then((source) => { if (active) setLoaded({ url, source }) })
      .catch(() => { if (active) setFailedUrl(url) })
    return () => { active = false }
  }, [url])

  const source = loaded?.url === url ? loaded.source : ''
  if (!source || failedUrl === url) return <ImagePlaceholder alt={alt} className={className} style={style} />

  return <img src={source} alt={alt} className={className} style={style} onError={() => setFailedUrl(url)} />
}

function ImagePlaceholder({ alt, className, style }: { alt: string; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-label={alt}
      className={className}
      style={{
        display: 'inline-block',
        width: 120,
        height: 90,
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        ...style,
      }}
    />
  )
}
