import type { ToolHandler } from '../types.js'
import { createTaskHandler, legacyCreateTaskHandler } from './create-task.js'
import { createScheduleHandler } from './create-schedule.js'
import { listTasksHandler } from './list-tasks.js'
import {
  scheduleCreateHandler,
  scheduleListHandler,
  scheduleUpdateHandler,
  scheduleDeleteHandler,
  scheduleToggleHandler,
  scheduleExecutionsHandler,
} from './schedule-tools.js'
import {
  studioTaskCreateHandler,
  studioTaskAssignHandler,
  studioTaskListHandler,
  studioTaskGetHandler,
  studioTaskUpdateProgressHandler,
  studioTaskRequestInputHandler,
  studioTaskMarkBlockedHandler,
  studioTaskMarkDoneHandler,
} from './studio-task-tools.js'
import {
  createAgentHandler,
  createProjectHandler,
  createSessionHandler,
  getAgentHandler,
  getProjectHandler,
  getSessionHandler,
  listTimelineHandler,
  listAgentsHandler,
  listModelProfilesHandler,
  listProjectsHandler,
  listSessionsHandler,
} from './core/index.js'
import {
  createTeamHandler,
  createTeamTaskHandler,
  describeTeamTemplateHandler,
  getTeamHandler,
  listTeamMailboxHandler,
  listTeamMembersHandler,
  listTeamTasksHandler,
  listTeamTemplatesHandler,
  listTeamsHandler,
  messageTeamMemberHandler,
  sendTeamMailboxHandler,
  spawnTeamMemberHandler,
  updateTeamHandler,
  updateTeamTaskHandler,
} from './team/index.js'
import {
  eventCategoryCreateHandler,
  eventCategoryListHandler,
  eventCategoryUpdateHandler,
  eventClaimNextHandler,
  eventConsumeHandler,
  eventConvertToTaskHandler,
  eventCreateHandler,
  eventGetHandler,
  eventIgnoreHandler,
  eventListHandler,
  eventSubscriptionCreateHandler,
} from './event-center-tools.js'
import {
  agentMessageSendHandler,
  agentSessionListHandler,
  agentSessionMessagesHandler,
  agentWatchCancelHandler,
  agentWatchCreateHandler,
} from './agent-session-tools.js'

const handlers = new Map<string, ToolHandler>()

function register(h: ToolHandler): void {
  handlers.set(h.name, h)
}

register(legacyCreateTaskHandler)
register(createTaskHandler)
register(createScheduleHandler)
register(listTasksHandler)
register(scheduleCreateHandler)
register(scheduleListHandler)
register(scheduleUpdateHandler)
register(scheduleDeleteHandler)
register(scheduleToggleHandler)
register(scheduleExecutionsHandler)
register(studioTaskCreateHandler)
register(studioTaskAssignHandler)
register(studioTaskListHandler)
register(studioTaskGetHandler)
register(studioTaskUpdateProgressHandler)
register(studioTaskRequestInputHandler)
register(studioTaskMarkBlockedHandler)
register(studioTaskMarkDoneHandler)
register(listProjectsHandler)
register(getProjectHandler)
register(createProjectHandler)
register(listAgentsHandler)
register(getAgentHandler)
register(createAgentHandler)
register(listModelProfilesHandler)
register(listSessionsHandler)
register(getSessionHandler)
register(createSessionHandler)
register(listTimelineHandler)
register(listTeamsHandler)
register(getTeamHandler)
register(createTeamHandler)
register(updateTeamHandler)
register(listTeamMembersHandler)
register(spawnTeamMemberHandler)
register(messageTeamMemberHandler)
register(listTeamMailboxHandler)
register(sendTeamMailboxHandler)
register(listTeamTasksHandler)
register(createTeamTaskHandler)
register(updateTeamTaskHandler)
register(listTeamTemplatesHandler)
register(describeTeamTemplateHandler)
register(eventCategoryListHandler)
register(eventCategoryCreateHandler)
register(eventCategoryUpdateHandler)
register(eventCreateHandler)
register(eventListHandler)
register(eventGetHandler)
register(eventClaimNextHandler)
register(eventConsumeHandler)
register(eventConvertToTaskHandler)
register(eventIgnoreHandler)
register(eventSubscriptionCreateHandler)
register(agentMessageSendHandler)
register(agentSessionListHandler)
register(agentSessionMessagesHandler)
register(agentWatchCreateHandler)
register(agentWatchCancelHandler)

export function getHandler(name: string): ToolHandler | undefined {
  return handlers.get(name)
}

export function getAllHandlers(): ToolHandler[] {
  return Array.from(handlers.values())
}

export function registerHandler(h: ToolHandler): void {
  handlers.set(h.name, h)
}
