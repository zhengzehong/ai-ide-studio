import type { AgentData } from '../../../stores/agent.store'
import { agentColor } from '../helpers'
import type { TaskStepData } from '../../../stores/task.store'

export const STEP_COLORS = {
  done: '#00b42a',
  running: '#165dff',
  ready: '#ff7d00',
  blocked: '#f53f3f',
  pending: '#e5e6eb',
} as const

export const STEP_TAG_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  done: { bg: '#f0f9eb', color: STEP_COLORS.done, label: 'done' },
  running: { bg: '#e8f3ff', color: STEP_COLORS.running, label: 'running' },
  ready: { bg: '#fff7e6', color: STEP_COLORS.ready, label: 'ready' },
  blocked: { bg: '#fff1f0', color: STEP_COLORS.blocked, label: 'blocked' },
  pending: { bg: '#f0f1f3', color: '#86909c', label: 'pending' },
}

export function stepColor(status: string): string {
  return STEP_COLORS[status as keyof typeof STEP_COLORS] ?? STEP_COLORS.pending
}

export function stepTagStyle(status: string): { bg: string; color: string; label: string } {
  return STEP_TAG_STYLES[status] ?? STEP_TAG_STYLES.pending
}

export function isCollabTask(steps: TaskStepData[] | undefined): boolean {
  if (!steps || steps.length === 0) return false
  if (steps.length > 1) return true
  return steps.some(s => s.dependsOn && s.dependsOn.length > 0)
}

export interface ParallelMarker {
  beforeStepId: string
  kind: 'parallel' | 'merge'
}

export function computeParallelMarkers(steps: TaskStepData[]): ParallelMarker[] {
  const markers: ParallelMarker[] = []
  if (steps.length < 2) return markers
  const byId = new Map(steps.map(s => [s.id, s]))

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]
    const curr = steps[i]
    if (!prev || !curr) continue
    const prevDeps = prev.dependsOn ?? []
    const currDeps = curr.dependsOn ?? []
    const sameDeps =
      prevDeps.length > 0 &&
      currDeps.length > 0 &&
      prevDeps.length === currDeps.length &&
      prevDeps.every(d => currDeps.includes(d))
    if (sameDeps) {
      markers.push({ beforeStepId: curr.id, kind: 'parallel' })
      continue
    }
    const currIsMerge =
      currDeps.length > 1 &&
      currDeps.every(d => byId.has(d) && byId.get(d)!.status === 'done')
    if (currIsMerge) {
      markers.push({ beforeStepId: curr.id, kind: 'merge' })
    }
  }
  return markers
}

export function agentInitials(name: string): string {
  if (!name) return '?'
  const first = name.charAt(0).toUpperCase()
  return first
}

export function agentBadgeStyle(agent: AgentData | undefined): { bg: string; text: string } {
  if (!agent) return { bg: '#86909c', text: '多' }
  return { bg: agentColor(agent), text: agentInitials(agent.name) }
}

export function formatStepTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
