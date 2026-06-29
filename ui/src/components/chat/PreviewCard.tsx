interface PreviewCardPreview {
  previewId: string
  title: string
  target: 'pc' | 'app'
  taskId?: string | null
  createdAt: string
}

interface PreviewCardProps {
  preview: PreviewCardPreview
  onOpen: (preview: {
    previewId: string
    title: string
    target: 'pc' | 'app'
    url: string
    taskId?: string | null
  }) => void
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    return `${days}天前`
  } catch {
    return iso
  }
}

export function PreviewCard({ preview, onOpen }: PreviewCardProps) {
  const { previewId, title, target, taskId, createdAt } = preview
  const isApp = target === 'app'
  const timeText = formatRelativeTime(createdAt)

  const handleClick = () => {
    onOpen({
      previewId,
      title,
      target,
      url: `/preview/${previewId}/`,
      taskId,
    })
  }

  return (
    <div
      onClick={handleClick}
      style={{
        marginTop: 10,
        background: '#1f1f23',
        border: '1px solid #3f3f46',
        borderLeft: '3px solid #3b82f6',
        borderRadius: 8,
        padding: '12px 14px',
        cursor: 'pointer',
        transition: 'all .15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#3b82f6'
        e.currentTarget.style.background = '#232328'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#3f3f46'
        e.currentTarget.style.background = '#1f1f23'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>{isApp ? '📱' : '🖥'}</span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 3,
            color: isApp ? '#10b981' : '#8b5cf6',
            background: isApp ? 'rgba(16,185,129,.12)' : 'rgba(139,92,246,.12)',
            flexShrink: 0,
          }}
        >
          {isApp ? 'APP' : 'PC'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 8 }}>
        {taskId && (
          <>
            <span style={{ marginRight: 4 }}>🔗 关联任务:</span>
            <span style={{ color: '#3b82f6', marginRight: 6 }}>{taskId}</span>
            <span>·</span>
            <span style={{ marginLeft: 6 }}>{timeText}</span>
          </>
        )}
        {!taskId && <span>{timeText}</span>}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          color: '#3b82f6',
          fontWeight: 500,
        }}
      >
        点击查看 →
      </div>
    </div>
  )
}
