import { createChildLogger } from './logger.js'
import { projectStore } from '../store/projects.js'

const log = createChildLogger('projects')

export function ensureProject(projectId: string) {
  const project = projectStore.get(projectId)
  if (!project) throw new Error(`项目不存在: ${projectId}`)
  return project
}

export function deleteProject(projectId: string): void {
  ensureProject(projectId)
  projectStore.delete(projectId)
  log.info({ projectId }, '项目已删除')
}
