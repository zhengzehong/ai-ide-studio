import { Navigate, useLocation } from 'react-router-dom'
import { buildProjectPath } from '../../routing/project-routes'
import { useProjectStore } from '../../stores/project.store'

interface LegacyProjectRedirectProps {
  subpath: string
}

export function LegacyProjectRedirect({ subpath }: LegacyProjectRedirectProps) {
  const location = useLocation()
  const initialized = useProjectStore((state) => state.initialized)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)

  if (!initialized) {
    return <div style={{ padding: 24, color: 'var(--text-3)' }}>正在加载项目...</div>
  }
  if (!currentProjectId) return <Navigate to="/projects" replace />
  return (
    <Navigate
      to={buildProjectPath(currentProjectId, {
        pathname: subpath,
        search: location.search,
        hash: location.hash,
      })}
      replace
    />
  )
}
