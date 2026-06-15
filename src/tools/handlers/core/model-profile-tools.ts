import { modelProfileStore, type ModelProfileRuntime } from '../../../store/model-profiles.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listModelProfilesHandler: ToolHandler = {
  name: 'core.model_profile.list',
  description: '列出模型档案',
  inputSchema: {
    type: 'object',
    properties: {
      runtime: { type: 'string', enum: ['claude', 'codex'] },
      enabledOnly: { type: 'boolean' },
    },
  },
  async execute(input: ToolHandlerInput, _context: ToolContext): Promise<ToolHandlerResult> {
    return jsonResult({
      profiles: modelProfileStore.list({
        runtime: optionalRuntime(input.runtime),
        enabledOnly: input.enabledOnly === true,
      }),
    })
  },
}

function optionalRuntime(value: unknown): ModelProfileRuntime | undefined {
  if (value === undefined) return undefined
  if (value === 'claude' || value === 'codex') return value
  throw new Error('runtime 必须是 claude 或 codex')
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}
