import type { ReactElement } from 'react'

export function ConversationKindTag({ team = false }: { team?: boolean }): ReactElement {
  return <span style={{ marginLeft: 6, padding: '1px 4px', border: '1px solid var(--border-light)', borderRadius: 4, fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{team ? '团队' : 'Agent'}</span>
}
