import * as acp from '@agentclientprotocol/sdk'
import type { AvailableCommandInfo, ConfigOptionInfo, SessionCapabilities } from '../types/ws-protocol.js'

function flattenSelectOptions(options: acp.SessionConfigSelect['options']): { value: string; name: string; description?: string; group?: string }[] {
  const flattened: { value: string; name: string; description?: string; group?: string }[] = []
  for (const option of options) {
    if ('options' in option) {
      for (const child of option.options) flattened.push({ value: child.value, name: child.name, description: child.description ?? undefined, group: option.name })
    } else {
      flattened.push({ value: option.value, name: option.name, description: option.description ?? undefined })
    }
  }
  return flattened
}

export function mapConfigOptions(options: acp.SessionConfigOption[]): ConfigOptionInfo[] {
  return options.map((option) => {
    const base = {
      id: option.id,
      name: option.name,
      description: option.description ?? undefined,
      category: option.category ?? undefined,
      type: option.type,
      currentValue: option.currentValue,
    }
    if (option.type === 'select') return { ...base, options: flattenSelectOptions(option.options) }
    return base
  })
}

export function mergeCapabilitiesFromConfig(caps: SessionCapabilities, configOptions: ConfigOptionInfo[]): SessionCapabilities {
  const next: SessionCapabilities = { ...caps, configOptions }
  const modelOpt = configOptions.find(o => o.category === 'model' || o.id === 'model')
  if (modelOpt?.type === 'select') {
    if (typeof modelOpt.currentValue === 'string') next.currentModelId = modelOpt.currentValue
    if (modelOpt.options) next.models = modelOpt.options.map(o => ({ modelId: o.value, name: o.name, description: o.description }))
  }
  const modeOpt = configOptions.find(o => o.category === 'mode' || o.id === 'mode')
  if (modeOpt?.type === 'select') {
    if (typeof modeOpt.currentValue === 'string') next.currentModeId = modeOpt.currentValue
    if (modeOpt.options) next.modes = modeOpt.options.map(o => ({ modeId: o.value, name: o.name, description: o.description }))
  }
  return next
}

export function mapAvailableCommands(commands: acp.AvailableCommand[]): AvailableCommandInfo[] {
  return commands.map(command => ({ name: command.name, description: command.description, input: command.input ? { hint: command.input.hint } : null }))
}
