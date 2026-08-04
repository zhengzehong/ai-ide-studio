import { randomUUID } from 'node:crypto'
import { agentStore } from '../store/agents.js'

export type AutonomyPlanStatus = 'current' | 'next' | 'done'

export interface AutonomyInterest {
  id: string
  text: string
  createdAt: string
}

export interface AutonomyPlanItem {
  id: string
  title: string
  status: AutonomyPlanStatus
  note?: string
}

export interface AgentAutonomyConfig {
  enabled: boolean
  prompt: string
  promptRevision: number
  interests: AutonomyInterest[]
  plan: {
    date: string
    items: AutonomyPlanItem[]
    nextCheckAt: string | null
    updatedAt: string | null
  }
  autonomySessionId: string | null
  heartbeatRuleId: string | null
  memoryPath: string
  dirty: boolean
  restartPending: boolean
  lastRunAt: string | null
  lastSkipReason: string | null
  lastError: string | null
}

export type AgentAutonomyPatch = Partial<Omit<AgentAutonomyConfig, 'plan'>> & {
  plan?: Partial<AgentAutonomyConfig['plan']>
}

export function getAgentAutonomyConfig(agentId: string): AgentAutonomyConfig {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  const root = parseRecord(agent.config_json)
  return normalizeAutonomy(root.autonomy)
}

export function updateAgentAutonomyConfig(agentId: string, patch: AgentAutonomyPatch): AgentAutonomyConfig {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent 不存在: ${agentId}`)
  const root = parseRecord(agent.config_json)
  const current = normalizeAutonomy(root.autonomy)
  const next = normalizeAutonomy({
    ...current,
    ...patch,
    plan: patch.plan ? { ...current.plan, ...patch.plan } : current.plan,
  })
  root.autonomy = next
  agentStore.update(agentId, { config: root })
  return next
}

export function createAutonomyInterest(text: string): AutonomyInterest {
  return {
    id: `aint-${randomUUID().slice(0, 8)}`,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  }
}

function normalizeAutonomy(value: unknown): AgentAutonomyConfig {
  const record = isRecord(value) ? value : {}
  const plan = isRecord(record.plan) ? record.plan : {}
  return {
    enabled: record.enabled === true,
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    promptRevision: nonNegativeInteger(record.promptRevision),
    interests: normalizeInterests(record.interests),
    plan: {
      date: typeof plan.date === 'string' ? plan.date : localDate(),
      items: normalizePlanItems(plan.items),
      nextCheckAt: nullableString(plan.nextCheckAt),
      updatedAt: nullableString(plan.updatedAt),
    },
    autonomySessionId: nullableString(record.autonomySessionId),
    heartbeatRuleId: nullableString(record.heartbeatRuleId),
    memoryPath: typeof record.memoryPath === 'string' ? record.memoryPath : '',
    dirty: record.dirty === true,
    restartPending: record.restartPending === true,
    lastRunAt: nullableString(record.lastRunAt),
    lastSkipReason: nullableString(record.lastSkipReason),
    lastError: nullableString(record.lastError),
  }
}

function normalizeInterests(value: unknown): AutonomyInterest[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): AutonomyInterest[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.text !== 'string') return []
    return [{
      id: item.id,
      text: item.text,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    }]
  }).slice(0, 50)
}

function normalizePlanItems(value: unknown): AutonomyPlanItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): AutonomyPlanItem[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return []
    if (item.status !== 'current' && item.status !== 'next' && item.status !== 'done') return []
    return [{
      id: item.id,
      title: item.title,
      status: item.status,
      ...(typeof item.note === 'string' ? { note: item.note } : {}),
    }]
  }).slice(0, 20)
}

function parseRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
