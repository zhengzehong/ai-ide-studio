import type { LocalSessionCandidateInfo } from '../../stores/session.store'
import { formatTime } from './helpers'

export function LocalSessionImportCandidateButton({
  candidate,
  active,
  onSelect,
}: {
  candidate: LocalSessionCandidateInfo
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        width: '100%',
        border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
        borderRadius: 8,
        background: active ? 'var(--blue-light)' : 'var(--bg-1)',
        color: 'var(--text-1)',
        cursor: 'pointer',
        padding: '9px 10px',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{candidate.label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatTime(candidate.updatedAt)}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {candidate.path}
      </div>
      {candidate.cwd && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
          cwd: {candidate.cwd}
        </div>
      )}
    </button>
  )
}
