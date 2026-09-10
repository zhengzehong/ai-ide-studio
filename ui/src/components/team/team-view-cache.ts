import type { MessageData } from '../../stores/session-events'
import type { Snapshot } from './team-chat-state'
import { useConnectionStore } from '../../stores/connection.store'

export interface TeamConversation {
  id: string; team_id: string; master_session_id: string; title: string
  status?: string; updated_at?: string; activity_state?: 'running' | 'idle' | null
  grid_session_ids?: string[] | null; unread?: boolean; last_message_at?: string | null
}
export interface TeamChatMember { id: string; agent_id: string; session_id: string; name: string; role: string }
export interface SourceMessage { message: MessageData; sourceSessionId: string; sourceMessageId: string }
export interface TeamChatCache { members: TeamChatMember[]; snapshots: Record<string, Snapshot>; sources: Map<string, SourceMessage> }

// Small, in-memory LRU caches. Server identity is part of the key so reconnecting
// to a different backend cannot expose content from the previous one.
export class TeamViewCache<T> {
  private entries = new Map<string, T>()
  private readonly limit: number
  constructor(limit: number) { this.limit = limit }
  delete(key: string): void { this.entries.delete(key) }
  get(key: string): T | undefined {
    const value = this.entries.get(key)
    if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value) }
    return value
  }
  set(key: string, value: T): void {
    this.entries.delete(key); this.entries.set(key, value)
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
  }
}

export const teamListCache = new TeamViewCache<TeamConversation[]>(20)
export const teamSelectionCache = new TeamViewCache<TeamConversation>(20)
export const teamChatCache = new TeamViewCache<TeamChatCache>(8)
let authEpoch = 0
useConnectionStore.subscribe((state, previous) => {
  if (state.token !== previous.token || state.authMode !== previous.authMode) authEpoch++
})
export function teamCacheKey(projectId: string, teamId: string, conversationId = ''): string {
  return `${typeof location === 'undefined' ? '' : location.origin}:${authEpoch}:${projectId}:${teamId}:${conversationId}`
}

const requests = new Map<string, Promise<unknown>>()
let requestScope = 0
export function newTeamRequestScope(): number { return ++requestScope }
export function invalidateTeamRequest(key: string): void { requests.delete(key) }
export function shareTeamRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = requests.get(key)
  if (existing) return existing as Promise<T>
  const pending = request().finally(() => { if (requests.get(key) === pending) requests.delete(key) })
  requests.set(key, pending)
  return pending
}
