import type { CreateToolInput } from '../store/tools.js'
import { DEVICE_INVOKE_DESCRIPTION, DEVICE_INVOKE_SCHEMA, DEVICE_LIST_DESCRIPTION } from '../devices/tool-contract.js'

export const DEVICE_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  { name: 'device_list', displayName: '列出远程电脑', description: DEVICE_LIST_DESCRIPTION,
    category: 'automation', type: 'builtin', config: { handler: 'device_list' },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permissions: { requiresApproval: false, maxExecutionTime: 15_000, networkAccess: true },
    isBuiltin: true, defaultScope: 'global' },
  { name: 'invoke_device_command', displayName: '操作远程电脑', description: DEVICE_INVOKE_DESCRIPTION,
    category: 'automation', type: 'builtin', config: { handler: 'invoke_device_command' }, inputSchema: DEVICE_INVOKE_SCHEMA,
    permissions: { requiresApproval: false, maxExecutionTime: 15_000, networkAccess: true },
    isBuiltin: true, defaultScope: 'global' },
]
