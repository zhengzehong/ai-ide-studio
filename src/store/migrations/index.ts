import { initialSchemaMigration } from './001-initial-schema.js'
import { projectScopeMigration } from './002-project-scope.js'
import { toolPlatformMigration } from './003-tool-platform.js'
import { modelAndSkillMigration } from './004-model-and-skill-settings.js'
import { teamMcpToolsMigration } from './005-team-mcp-tools.js'
import type { Migration } from '../migrator.js'

export const migrations: Migration[] = [
  initialSchemaMigration,
  projectScopeMigration,
  toolPlatformMigration,
  modelAndSkillMigration,
  teamMcpToolsMigration,
]
