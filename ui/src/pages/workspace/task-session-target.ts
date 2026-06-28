import type { SessionMode } from '../../stores/task.store'

export interface WorkspaceTaskSessionTargetInput {
  agentId: string
  sessionMode: SessionMode
  sessionId: string
}

export interface WorkspaceTaskSessionTarget {
  agentId?: string
  sessionMode?: SessionMode
  sessionId?: string
}

export function buildWorkspaceTaskCreateTarget(input: WorkspaceTaskSessionTargetInput): WorkspaceTaskSessionTarget {
  if (!input.agentId) return { agentId: undefined, sessionMode: undefined, sessionId: undefined }

  return {
    agentId: input.agentId,
    sessionMode: input.sessionMode,
    sessionId: input.sessionMode === 'existing' ? input.sessionId || undefined : undefined,
  }
}
