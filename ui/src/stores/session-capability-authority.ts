import {
  capabilitiesFromConfig,
  mergeCapabilities,
  type SessionCapabilities,
} from './session-events'

export function mergeHistoricalCapabilities(
  current: SessionCapabilities,
  historical: SessionCapabilities,
  preserveCurrentValues: boolean,
): SessionCapabilities {
  const merged = mergeCapabilities(current, historical)
  if (!preserveCurrentValues) return merged

  const currentValues = new Map(
    current.configOptions
      .filter((option) => option.currentValue !== undefined)
      .map((option) => [option.id, option.currentValue] as const),
  )
  const configOptions = merged.configOptions.map((option) => (
    currentValues.has(option.id)
      ? { ...option, currentValue: currentValues.get(option.id) }
      : option
  ))
  const withConfig = capabilitiesFromConfig(merged, configOptions)
  return {
    ...withConfig,
    currentModelId: current.currentModelId ?? withConfig.currentModelId,
    currentModeId: current.currentModeId ?? withConfig.currentModeId,
  }
}
