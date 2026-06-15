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
import { agentVisibilityMigration } from './018-agent-visibility.js'
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
  agentVisibilityMigration,
]
