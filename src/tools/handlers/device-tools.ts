import { executeDeviceTool } from '../../devices/tool-provider.js'
import { DEVICE_INVOKE_DESCRIPTION, DEVICE_INVOKE_SCHEMA, DEVICE_LIST_DESCRIPTION } from '../../devices/tool-contract.js'
import type { ToolHandler } from '../types.js'

export const deviceListHandler: ToolHandler = {
  name: 'device_list', description: DEVICE_LIST_DESCRIPTION,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async execute(input, context) {
    return { content: [{ type: 'text', text: JSON.stringify(await executeDeviceTool('device_list', input, context)) }] }
  },
}

export const invokeDeviceCommandHandler: ToolHandler = {
  name: 'invoke_device_command', description: DEVICE_INVOKE_DESCRIPTION, inputSchema: DEVICE_INVOKE_SCHEMA,
  async execute(input, context) {
    return { content: [{ type: 'text', text: JSON.stringify(await executeDeviceTool('invoke_device_command', input, context)) }] }
  },
}
