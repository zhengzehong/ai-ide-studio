import type { EventConsumptionRow } from '../store/event-consumptions.js'
import type { EventCenterEventRow, EventEvidenceItem } from '../store/event-center-events.js'

export interface CreateEventInput {
  projectId?: string | null
  categoryId: string
  title: string
  summary?: string | null
  sourceType?: string
  sourceId?: string | null
  sourceLabel?: string | null
  priority?: string
  confidence?: number
  tags?: string[]
  payload?: Record<string, unknown>
  evidence?: EventEvidenceItem[]
  dedupeKey?: string | null
  createdByAgentId?: string | null
}

export interface ClaimNextEventInput {
  projectId?: string
  agentId: string
}

export interface ConsumeEventInput {
  consumptionId: string
  resultSummary?: string
  result?: Record<string, unknown>
  error?: string
}

export interface ClaimedEvent {
  event: EventCenterEventRow
  consumption: EventConsumptionRow
}

export interface RunEventConsumerResult {
  event: EventCenterEventRow
  consumption: EventConsumptionRow
  sessionId: string | null
  claimFailed?: boolean
}

export interface RunEventConsumerInput {
  consumptionId: string
  sessionId?: string
}
