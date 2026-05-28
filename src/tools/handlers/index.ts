import type { ToolHandler } from '../types.js'
import { createTaskHandler, legacyCreateTaskHandler } from './create-task.js'
import { createScheduleHandler } from './create-schedule.js'
import { listTasksHandler } from './list-tasks.js'
import {
  createAgentHandler,
  createProjectHandler,
  createSessionHandler,
  getAgentHandler,
  getProjectHandler,
  getSessionHandler,
  listAgentsHandler,
  listProjectsHandler,
  listSessionsHandler,
} from './core/index.js'

const handlers = new Map<string, ToolHandler>()

function register(h: ToolHandler): void {
  handlers.set(h.name, h)
}

register(legacyCreateTaskHandler)
register(createTaskHandler)
register(createScheduleHandler)
register(listTasksHandler)
register(listProjectsHandler)
register(getProjectHandler)
register(createProjectHandler)
register(listAgentsHandler)
register(getAgentHandler)
register(createAgentHandler)
register(listSessionsHandler)
register(getSessionHandler)
register(createSessionHandler)

export function getHandler(name: string): ToolHandler | undefined {
  return handlers.get(name)
}

export function getAllHandlers(): ToolHandler[] {
  return Array.from(handlers.values())
}

export function registerHandler(h: ToolHandler): void {
  handlers.set(h.name, h)
}
