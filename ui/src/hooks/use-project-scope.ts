import { useOutletContext } from 'react-router-dom'

export interface ProjectScopeContextValue {
  projectId: string
}

export function useProjectScope(): ProjectScopeContextValue {
  return useOutletContext<ProjectScopeContextValue>()
}

export function useProjectScopeId(): string {
  return useProjectScope().projectId
}
