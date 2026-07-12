import { type CSSProperties } from 'react'
import { Share2, Plus, Loader2 } from 'lucide-react'

export function EmptyState({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <div style={styles.emptyState}>
      <Share2 size={36} color="var(--text-3)" strokeWidth={1.5} />
      <div style={{ marginTop: 12, fontWeight: 600, color: 'var(--text-2)' }}>还没有分享过会话</div>
      <div style={{ marginTop: 4, color: 'var(--text-3)', fontSize: 13 }}>点击右上角新建分享</div>
      <button type="button" onClick={onCreate} disabled={disabled} style={{ ...styles.createBtn, marginTop: 12 }}>
        <Plus size={14} /> 新建分享
      </button>
    </div>
  )
}

export function SkeletonRows() {
  return (
    <div style={{ padding: 20 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={styles.skeletonRow}>
          <Loader2 size={14} color="var(--text-3)" style={{ animation: 'spin 1s linear infinite' }} />
          <div style={styles.skeletonBar} />
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', color: 'var(--text-3)' },
  createBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  skeletonRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' },
  skeletonBar: { flex: 1, height: 14, borderRadius: 4, background: 'var(--bg-2)' },
}
