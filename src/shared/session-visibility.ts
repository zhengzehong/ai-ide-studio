export type SessionPurpose =
  | 'conversation'
  | 'autonomy'
  | 'secretary_runtime'
  | 'secretary_chat'
  | 'advisor_runtime'
  | 'inspiration_runtime'

export function isUserVisibleSession(session: { purpose?: string; is_template?: number | boolean }): boolean {
  // Missing purpose is supported for older clients/servers.
  return (session.purpose === undefined || session.purpose === 'conversation') && !session.is_template
}
