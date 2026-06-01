import type { AgentData } from '../../stores/agent.store'
import type { TeamMemberData } from '../../stores/team.store'
import { roleLabel } from './labels'

const statusLabels: Record<string, string> = {
  active: '活跃',
  removed: '已移除',
}

export function TeamMemberRow({
  member,
  agent,
  active,
  onClick,
}: {
  member: TeamMemberData
  agent?: AgentData
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        padding: '9px 10px',
        borderRadius: 9,
        border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
        background: active ? 'var(--blue-light)' : 'var(--bg-1)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: active ? 'var(--blue)' : 'var(--bg-3)',
            color: active ? 'white' : 'var(--text-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {member.name.charAt(0).toUpperCase()}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--text-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {member.name}
          </span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
            {roleLabel(member.role)} · {agent?.runtime || 'agent'} · {statusLabels[member.status] || member.status}
          </span>
        </span>
        {active && <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, flexShrink: 0 }}>当前</span>}
      </div>
    </button>
  )
}
