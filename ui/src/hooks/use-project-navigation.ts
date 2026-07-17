import { useCallback } from 'react'
import {
  useLocation,
  useNavigate,
  useParams,
  type NavigateOptions,
} from 'react-router-dom'
import {
  buildProjectPath,
  readLastProjectLocation,
  rememberProjectLocation,
  stripProjectPrefix,
} from '../routing/project-routes'
import { useProjectStore } from '../stores/project.store'

export interface ProjectNavigation {
  switchProject: (projectId: string) => void
  toProjectPath: (subpath: string) => string
  navigateInProject: (subpath: string, options?: NavigateOptions) => void
}

export function useProjectNavigation(): ProjectNavigation {
  const navigate = useNavigate()
  const location = useLocation()
  const { projectId: routeProjectId } = useParams<{ projectId: string }>()
  const currentProjectId = useProjectStore((state) => state.currentProjectId)

  const switchProject = useCallback((targetProjectId: string): void => {
    if (routeProjectId) {
      rememberProjectLocation(routeProjectId, {
        pathname: stripProjectPrefix(location.pathname, routeProjectId),
        search: location.search,
        hash: location.hash,
      })
      if (routeProjectId === targetProjectId) return
    }
    navigate(buildProjectPath(targetProjectId, readLastProjectLocation(targetProjectId)))
  }, [location.hash, location.pathname, location.search, navigate, routeProjectId])

  const toProjectPath = useCallback((subpath: string): string => {
    const projectId = routeProjectId ?? currentProjectId
    if (!projectId) return '/'
    return buildProjectPath(projectId, { pathname: subpath, search: '', hash: '' })
  }, [currentProjectId, routeProjectId])

  const navigateInProject = useCallback((subpath: string, options?: NavigateOptions): void => {
    navigate(toProjectPath(subpath), options)
  }, [navigate, toProjectPath])

  return { switchProject, toProjectPath, navigateInProject }
}
