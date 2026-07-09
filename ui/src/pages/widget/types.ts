export type WidgetTab = 'agents' | 'tasks'

export type TaskFilter = 'draft' | 'active' | 'all'

export interface ElectronWidgetApi {
  togglePin: () => void
  minimize: () => void
  openMain: (target?: { projectId?: string | null; sessionId?: string | null }) => void
}

export const electronApi = (window as unknown as { electronWidget?: ElectronWidgetApi }).electronWidget

export const ACTIVE_TASK_STATUSES = new Set(['running', 'needs_input'])
