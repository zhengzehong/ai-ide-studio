import { useEffect, useLayoutEffect } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { activateProjectData } from '../../project-scope/project-data-scope'
import { rememberProjectLocation, stripProjectPrefix } from '../../routing/project-routes'
import { useProjectStore } from '../../stores/project.store'

export function ProjectScopeLayout() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const location = useLocation()
  const projects = useProjectStore((state) => state.projects)
  const initialized = useProjectStore((state) => state.initialized)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const selectProject = useProjectStore((state) => state.selectProject)
  const projectExists = projects.some((project) => project.id === projectId)

  useLayoutEffect(() => {
    if (!initialized || !projectExists) return
    if (currentProjectId !== projectId) selectProject(projectId)
    void activateProjectData(projectId)
  }, [currentProjectId, initialized, projectExists, projectId, selectProject])

  useEffect(() => {
    if (!initialized || !projectExists) return
    rememberProjectLocation(projectId, {
      pathname: stripProjectPrefix(location.pathname, projectId),
      search: location.search,
      hash: location.hash,
    })
  }, [initialized, location.hash, location.pathname, location.search, projectExists, projectId])

  if (!initialized) {
    return <div style={{ padding: 24, color: 'var(--text-3)' }}>正在加载项目...</div>
  }
  if (!projectExists) return <Navigate to="/projects?error=project-not-found" replace />
  return <Outlet key={projectId} context={{ projectId }} />
}
