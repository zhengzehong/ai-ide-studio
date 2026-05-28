import type { ToolHandler } from '../types.js'
import { createTaskHandler, legacyCreateTaskHandler } from './create-task.js'
import { createScheduleHandler } from './create-schedule.js'
import { listTasksHandler } from './list-tasks.js'

const handlers = new Map<string, ToolHandler>()

function register(h: ToolHandler) {
  handlers.set(h.name, h)
}

register(legacyCreateTaskHandler)
register(createTaskHandler)
register(createScheduleHandler)
register(listTasksHandler)

export function getHandler(name: string): ToolHandler | undefined {
  return handlers.get(name)
}

export function getAllHandlers(): ToolHandler[] {
  return Array.from(handlers.values())
}

export function registerHandler(h: ToolHandler): void {
  handlers.set(h.name, h)
}
