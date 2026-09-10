import { elapsedSecondsBetween } from '../../utils/duration'

export interface TurnStats {
  inputTokens?: number
  outputTokens?: number
  cachedReadTokens?: number
  costAmount?: number
  elapsedSeconds?: number
}

export function parseTurnStats(raw?: string | null, startedAt?: string | null, completedAt?: string | null): TurnStats | null {
  const elapsedSeconds = elapsedSecondsBetween(startedAt, completedAt)
  const fallback = elapsedSeconds == null ? null : { elapsedSeconds }
  if (!raw) return fallback
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
    const stats = value as Record<string, unknown>
    const number = (key: string): number | undefined => typeof stats[key] === 'number' && Number.isFinite(stats[key]) ? stats[key] : undefined
    return {
      inputTokens: number('inputTokens'),
      outputTokens: number('outputTokens'),
      cachedReadTokens: number('cachedReadTokens'),
      costAmount: number('costAmount'),
      elapsedSeconds: number('elapsedSeconds') ?? elapsedSeconds,
    }
  } catch { return fallback }
}
