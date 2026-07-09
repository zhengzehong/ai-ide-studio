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
  studioTaskCreateSimpleHandler,
  studioTaskListHandler,
  studioTaskGetHandler,
  studioTaskUpdateHandler,
} from './studio-task-crud-tools.js'
import {
  studioTaskAssignHandler,
  studioTaskStartHandler,
  studioTaskUpdateProgressHandler,
  studioTaskReportHandler,
} from './studio-task-flow-tools.js'
import {
  studioTaskStepGetHandler,
  studioTaskStepAddHandler,
  studioTaskStepUpdateHandler,
  studioTaskStepRemoveHandler,
  studioTaskStepUpdateProgressHandler,
  studioTaskStepReportHandler,
} from './studio-task-step-tools.js'
import {
  createAgentHandler,
  createAgentTemplateHandler,
  createProjectHandler,
  createSessionHandler,
  defineMemoryDimensionHandler,
  deleteAgentTemplateHandler,
  getAgentHandler,
  getAgentTemplateHandler,
  getProjectHandler,
  getSessionHandler,
  listTimelineHandler,
  listAgentsHandler,
  listAgentTemplatesHandler,
  listKnowledgeBasesHandler,
  readKnowledgeIndexHandler,
  readKnowledgePageHandler,
  searchKnowledgePagesHandler,
  createKnowledgePageHandler,
  updateKnowledgePageHandler,
  refreshKnowledgeFromCodeHandler,
  createKnowledgeBaseHandler,
  mountKnowledgeBaseHandler,
  unmountKnowledgeBaseHandler,
  revertKnowledgeActivityHandler,
  recallMemoryHandler,
  listMemoryHandler,
  getMemoryHandler,
  recordMemoryHandler,
  updateMemoryHandler,
  deleteMemoryHandler,
  seedBuiltinMemoryDimensionsHandler,
  listModelProfilesHandler,
  listProjectsHandler,
  listSessionsHandler,
  updateAgentTemplateHandler,
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
import { previewPublishHandler } from './preview-publish.js'
import {
  agentHubConnectHandler,
  agentHubDisconnectHandler,
  agentHubListHandler,
  agentHubSendHandler,
  agentHubUploadFileHandler,
} from './agent-hub.js'

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
register(studioTaskCreateSimpleHandler)
register(studioTaskAssignHandler)
register(studioTaskListHandler)
register(studioTaskGetHandler)
register(studioTaskUpdateHandler)
register(studioTaskStartHandler)
register(studioTaskUpdateProgressHandler)
register(studioTaskReportHandler)
register(studioTaskStepGetHandler)
register(studioTaskStepAddHandler)
register(studioTaskStepUpdateHandler)
register(studioTaskStepRemoveHandler)
register(studioTaskStepUpdateProgressHandler)
register(studioTaskStepReportHandler)
register(defineMemoryDimensionHandler)
register(listProjectsHandler)
register(getProjectHandler)
register(createProjectHandler)
register(listAgentsHandler)
register(getAgentHandler)
register(createAgentHandler)
register(listAgentTemplatesHandler)
register(getAgentTemplateHandler)
register(createAgentTemplateHandler)
register(updateAgentTemplateHandler)
register(deleteAgentTemplateHandler)
register(listModelProfilesHandler)
register(listSessionsHandler)
register(getSessionHandler)
register(createSessionHandler)
register(listTimelineHandler)
register(listKnowledgeBasesHandler)
register(readKnowledgeIndexHandler)
register(readKnowledgePageHandler)
register(searchKnowledgePagesHandler)
register(createKnowledgePageHandler)
register(updateKnowledgePageHandler)
register(refreshKnowledgeFromCodeHandler)
register(createKnowledgeBaseHandler)
register(mountKnowledgeBaseHandler)
register(unmountKnowledgeBaseHandler)
register(revertKnowledgeActivityHandler)
register(recallMemoryHandler)
register(listMemoryHandler)
register(getMemoryHandler)
register(recordMemoryHandler)
register(updateMemoryHandler)
register(deleteMemoryHandler)
register(seedBuiltinMemoryDimensionsHandler)
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
register(previewPublishHandler)
register(agentHubConnectHandler)
register(agentHubDisconnectHandler)
register(agentHubListHandler)
register(agentHubSendHandler)
register(agentHubUploadFileHandler)

export function getHandler(name: string): ToolHandler | undefined {
  return handlers.get(name)
}

export function getAllHandlers(): ToolHandler[] {
  return Array.from(handlers.values())
}

export function registerHandler(h: ToolHandler): void {
  handlers.set(h.name, h)
}
