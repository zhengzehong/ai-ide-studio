import { useCallback } from 'react'
import { useProjectViewStateStore } from '../../stores/project-view-state.store'

export interface WorkspaceProjectState {
  sidebarTab: 'sessions' | 'files'
  selectedAgentId: string | null
  setSidebarTab: (tab: 'sessions' | 'files') => void
  setSelectedAgentId: (agentId: string | null) => void
}

export function useWorkspaceProjectState(projectId: string | null): WorkspaceProjectState {
  const workspace = useProjectViewStateStore((state) => (
    projectId ? state.byProjectId[projectId]?.workspace : undefined
  ))
  const patchWorkspace = useProjectViewStateStore((state) => state.patchWorkspace)
  const setSidebarTab = useCallback((sidebarTab: 'sessions' | 'files'): void => {
    if (projectId) patchWorkspace(projectId, { sidebarTab })
  }, [patchWorkspace, projectId])
  const setSelectedAgentId = useCallback((selectedAgentId: string | null): void => {
    if (projectId) patchWorkspace(projectId, { selectedAgentId })
  }, [patchWorkspace, projectId])

  return {
    sidebarTab: workspace?.sidebarTab ?? 'sessions',
    selectedAgentId: workspace?.selectedAgentId ?? null,
    setSidebarTab,
    setSelectedAgentId,
  }
}
