import { buildProjectPath } from '../../routing/project-routes'

export { isSecretarySessionPurpose } from '../../stores/secretary-session'

export function secretaryWorkspacePath(projectId: string, secretaryId: string, sessionId: string): string {
  const search = new URLSearchParams({ sessionId, secretaryId })
  return buildProjectPath(projectId, {
    pathname: '/workspace',
    search: `?${search.toString()}`,
    hash: '',
  })
}
