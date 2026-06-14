import type { ToolRuntimeContext } from './tool-runtime.js'

type JsonObject = Record<string, unknown>

const ALWAYS_HIDDEN_FIELDS = ['fromMemberId', 'leaderAgentId', 'teamMemberId']
const PROJECT_ID_VISIBLE_TOOLS = new Set(['core.project.get'])

export function sanitizeRuntimeToolInputSchema(
  toolName: string,
  inputSchema: object,
  context: ToolRuntimeContext,
): object {
  const schema = cloneJsonObject(inputSchema)
  const properties = schema.properties
  if (!isRecord(properties)) return schema

  const hidden = new Set(ALWAYS_HIDDEN_FIELDS)
  if (context.projectId && !PROJECT_ID_VISIBLE_TOOLS.has(toolName)) hidden.add('projectId')
  if (context.teamId) hidden.add('teamId')
  if (toolName === 'team.task.update' && context.teamMemberId) hidden.add('assigneeMemberId')

  for (const field of hidden) {
    delete properties[field]
  }

  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((item) => typeof item === 'string' && !hidden.has(item))
  }

  return schema
}

function cloneJsonObject(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
