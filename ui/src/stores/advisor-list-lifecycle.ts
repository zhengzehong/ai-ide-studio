import type { AdvisorSuggestion, AdvisorSuggestionView } from './advisor.store'

export function suggestionDeadline(row: AdvisorSuggestion): number {
  return Math.min(Date.parse(row.expire_at), Date.parse(row.created_at) + 86_400_000)
}

export function filterAdvisorView(view: AdvisorSuggestionView, now: number): AdvisorSuggestionView {
  const suggestions = view.suggestions.filter(row =>
    (row.status === 'pending' || row.status === 'viewed') && suggestionDeadline(row) > now)
  const settled = view.settled.filter(row =>
    (row.status === 'accepted' || row.status === 'created') && suggestionDeadline(row) > now)
  const pendingCount = suggestions.filter(row => row.status === 'pending').length
  if (suggestions.length === view.suggestions.length && settled.length === view.settled.length
    && view.expired.length === 0 && pendingCount === view.pendingCount) return view
  return { ...view, suggestions, settled, expired: [], pendingCount }
}

export function receivedAdvisorView(view: AdvisorSuggestionView): { view: AdvisorSuggestionView; clockOffsetMs: number } {
  const serverTime = Date.parse(view.serverNow ?? '')
  const now = Number.isFinite(serverTime) ? serverTime : Date.now()
  return { view: filterAdvisorView(view, now), clockOffsetMs: now - Date.now() }
}
