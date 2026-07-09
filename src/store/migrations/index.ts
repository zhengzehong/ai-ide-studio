import { initialSchemaMigration } from './001-initial-schema.js'
import { projectScopeMigration } from './002-project-scope.js'
import { toolPlatformMigration } from './003-tool-platform.js'
import { modelAndSkillMigration } from './004-model-and-skill-settings.js'
import { teamMcpToolsMigration } from './005-team-mcp-tools.js'
import { modelProfilesMigration } from './006-model-profiles.js'
import { scheduleEnhancementMigration } from './007-schedule-enhancement.js'
import { messageFileChangesMigration } from './008-message-file-changes.js'
import { timelineSummariesMigration } from './009-timeline-summaries.js'
import { turnProcessItemsMigration } from './010-turn-process-items.js'
import { widgetStateMigration } from './011-widget-state.js'
import { sessionRuntimePreferencesMigration } from './012-session-runtime-preferences.js'
import { globalAssistantMigration } from './013-global-assistant.js'
import { eventCenterMigration } from './014-event-center.js'
import { workspaceCustomOrderingMigration } from './015-workspace-custom-ordering.js'
import { agentSessionCommunicationMigration } from './016-agent-session-communication.js'
import { eventCategoryProjectScopeMigration } from './017-event-category-project-scope.js'
import { agentVisibilityMigration } from './018-agent-visibility.js'
import { eventConsumerSessionStrategyMigration } from './019-event-consumer-session-strategy.js'
import { modelProfileDefaultMigration } from './020-model-profile-default.js'
import { knowledgeBaseMigration } from './021-knowledge-base.js'
import { sessionReadStateMigration } from './022-session-read-state.js'
import { taskAttachmentsMigration } from './023-task-attachments.js'
import { taskReportStatusMigration } from './024-task-report-status.js'
import { taskExecutionModesMigration } from './025-task-execution-modes.js'
import { projectMetaMigration } from './026-project-meta.js'
import { sessionPrimaryMigration } from './027-session-primary.js'
import { agentMemoryMigration } from './028-agent-memory.js'
import { previewsMigration } from './029-previews.js'
import { formalCodeMergeSchemaMigration } from './030-formal-code-merge-schema.js'
import { addSettingsTableMigration } from './031-add-settings-table.js'
import { agentAvatarMigration } from './032-agent-avatar.js'
import { agentHubConnectionsMigration } from './033-agent-hub-connections.js'
import { agentMemoryBuiltinDimsMigration } from './034-agent-memory-builtin-dims.js'
import { agentMemoryInjectFullMigration } from './035-agent-memory-inject-full.js'
import { ensureAgentAvatarColumnsMigration } from './036-ensure-agent-avatar-columns.js'
import { taskStepsMigration } from './037-task-steps.js'
import { agentWatchWakeMigration } from './038-agent-watch-wake.js'
import type { Migration } from '../migrator.js'

export const migrations: Migration[] = [
  initialSchemaMigration,
  projectScopeMigration,
  toolPlatformMigration,
  modelAndSkillMigration,
  teamMcpToolsMigration,
  modelProfilesMigration,
  scheduleEnhancementMigration,
  messageFileChangesMigration,
  timelineSummariesMigration,
  turnProcessItemsMigration,
  widgetStateMigration,
  sessionRuntimePreferencesMigration,
  globalAssistantMigration,
  eventCenterMigration,
  workspaceCustomOrderingMigration,
  agentSessionCommunicationMigration,
  eventCategoryProjectScopeMigration,
  agentVisibilityMigration,
  eventConsumerSessionStrategyMigration,
  modelProfileDefaultMigration,
  knowledgeBaseMigration,
  sessionReadStateMigration,
  taskAttachmentsMigration,
  taskReportStatusMigration,
  taskExecutionModesMigration,
  projectMetaMigration,
  sessionPrimaryMigration,
  agentMemoryMigration,
  previewsMigration,
  formalCodeMergeSchemaMigration,
  addSettingsTableMigration,
  agentAvatarMigration,
  agentHubConnectionsMigration,
  agentMemoryBuiltinDimsMigration,
  agentMemoryInjectFullMigration,
  ensureAgentAvatarColumnsMigration,
  taskStepsMigration,
  agentWatchWakeMigration,
]

